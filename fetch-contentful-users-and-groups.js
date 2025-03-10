require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const { Parser } = require("json2csv");

// ----------------------------------------
// CONFIG
// ----------------------------------------
const MANAGEMENT_API_KEY = process.env.CONTENTFUL_MANAGEMENT_API_TOKEN;
const ORGANIZATION_ID = process.env.CONTENTFUL_ORGANIZATION_ID;
const BASE_URL = "https://api.contentful.com";

/**
 * Fetch data from a paginated endpoint, merging items and includes across all pages.
 * Returns { allItems, allUsers }
 *   allItems: combined membership (or team) items
 *   allUsers: Map of userId -> user object (from includes.User)
 */
async function fetchPagedDataWithIncludes(url, includeParams = "") {
  let skip = 0;
  const limit = 100;

  const allItems = [];
  const allUsers = new Map(); // userId -> user object

  while (true) {
    try {
      const resp = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${MANAGEMENT_API_KEY}`,
        },
        params: {
          limit,
          skip,
          include: includeParams, // e.g. "sys.user" or "sys.user,sys.organizationMembership"
        },
      });

      const { items = [], total = 0, includes } = resp.data;
      allItems.push(...items);

      // Collect user details from top-level includes
      if (includes && includes.User && Array.isArray(includes.User)) {
        includes.User.forEach((u) => {
          if (u.sys?.id) {
            allUsers.set(u.sys.id, u);
          }
        });
      }

      skip += limit;
      if (skip >= total) {
        break;
      }
    } catch (err) {
      console.error(`Error fetching data from ${url}:`, err.message);
      break;
    }
  }

  return { allItems, allUsers };
}

/**
 * 1) ORG MEMBERSHIPS
 *    GET /organizations/{orgId}/organization_memberships?include=sys.user
 */
async function fetchOrganizationMemberships() {
  const url = `${BASE_URL}/organizations/${ORGANIZATION_ID}/organization_memberships`;
  return fetchPagedDataWithIncludes(url, "sys.user");
}

/**
 * 2) SPACE MEMBERSHIPS
 *    GET /organizations/{orgId}/space_memberships?include=sys.user
 */
async function fetchSpaceMemberships() {
  const url = `${BASE_URL}/organizations/${ORGANIZATION_ID}/space_memberships`;
  return fetchPagedDataWithIncludes(url, "sys.user");
}

/**
 * 3) TEAM MEMBERSHIPS
 *    - GET /organizations/{orgId}/teams
 *    - For each team => GET /teams/{teamId}/team_memberships?include=sys.user,sys.organizationMembership
 */
async function fetchTeamMemberships() {
  const teamsUrl = `${BASE_URL}/organizations/${ORGANIZATION_ID}/teams`;
  const { allItems: allTeams } = await fetchPagedDataWithIncludes(teamsUrl);

  const userToTeams = {}; // { userId -> [TeamName, ...] }

  for (const team of allTeams) {
    const teamId = team.sys?.id;
    const teamName = team.name;
    if (!teamId) continue;

    const membershipsUrl = `${BASE_URL}/organizations/${ORGANIZATION_ID}/teams/${teamId}/team_memberships`;
    const { allItems: teamMemberships } = await fetchPagedDataWithIncludes(
      membershipsUrl,
      "sys.user,sys.organizationMembership"
    );

    for (const membership of teamMemberships) {
      const userId = membership.sys?.user?.sys?.id;
      if (!userId) continue;
      if (!userToTeams[userId]) {
        userToTeams[userId] = [];
      }
      userToTeams[userId].push(teamName);
    }
  }

  return userToTeams;
}

// Helper to extract role names (org or space) from a membership object
function getRoleNames(membership) {
  const results = [];

  // Check if they're an admin (space-level admin)
  if (membership.admin) {
    results.push("Admin");
  }

  // If there's a multi-role array, gather them
  if (Array.isArray(membership.roles) && membership.roles.length) {
    membership.roles.forEach((r) => {
      // e.g. r = { name: 'Editor', ... }
      if (r.name) {
        results.push(r.name);
      }
    });
  }

  // If there's a single role property (legacy)
  if (membership.role) {
    results.push(membership.role);
  }

  // De-dupe
  return [...new Set(results)];
}

(async () => {
  try {
    const userMap = {};

    // -----------------------------
    // 1) ORG MEMBERSHIPS
    // -----------------------------
    const { allItems: orgItems, allUsers: orgUsers } =
      await fetchOrganizationMemberships();

    for (const membership of orgItems) {
      const userId = membership.sys?.user?.sys?.id;
      if (!userId) continue;

      // Gather org roles
      const orgRoleNames = getRoleNames(membership);

      // Get user from includes
      const userObj = orgUsers.get(userId);
      const email = userObj?.email || "";
      const name = `${userObj?.firstName || ""} ${
        userObj?.lastName || ""
      }`.trim();

      if (!userMap[userId]) {
        userMap[userId] = {
          userId,
          email,
          name,
          orgRoles: [],
          spaceRoles: [],
          teams: [],
        };
      }
      // Merge new org roles
      userMap[userId].orgRoles = [
        ...new Set([...userMap[userId].orgRoles, ...orgRoleNames]),
      ];
    }

    // -----------------------------
    // 2) SPACE MEMBERSHIPS
    // -----------------------------
    const { allItems: spaceItems, allUsers: spaceUsers } =
      await fetchSpaceMemberships();
    for (const membership of spaceItems) {
      const userId = membership.sys?.user?.sys?.id;
      if (!userId) continue;

      // Gather space roles
      const spaceRoleNames = getRoleNames(membership);

      // Get user from includes
      const userObj = spaceUsers.get(userId);
      const email = userObj?.email || "";
      const name = `${userObj?.firstName || ""} ${
        userObj?.lastName || ""
      }`.trim();

      if (!userMap[userId]) {
        userMap[userId] = {
          userId,
          email,
          name,
          orgRoles: [],
          spaceRoles: [],
          teams: [],
        };
      }
      // Merge new space roles
      userMap[userId].spaceRoles = [
        ...new Set([...userMap[userId].spaceRoles, ...spaceRoleNames]),
      ];
    }

    // -----------------------------
    // 3) TEAM MEMBERSHIPS
    // -----------------------------
    const userToTeams = await fetchTeamMemberships();
    for (const [userId, teamNames] of Object.entries(userToTeams)) {
      if (!userMap[userId]) {
        userMap[userId] = {
          userId,
          email: "",
          name: "",
          orgRoles: [],
          spaceRoles: [],
          teams: [],
        };
      }
      userMap[userId].teams = [
        ...new Set([...userMap[userId].teams, ...teamNames]),
      ];
    }

    // -----------------------------
    // Produce final CSV
    // -----------------------------
    const finalData = Object.values(userMap).map((u) => ({
      userId: u.userId,
      email: u.email,
      name: u.name,
      orgRoles: u.orgRoles.join("; "),
      spaceRoles: u.spaceRoles.join("; "),
      teams: u.teams.join("; "),
    }));

    const parser = new Parser({
      fields: ["userId", "email", "name", "orgRoles", "spaceRoles", "teams"],
    });

    const csv = parser.parse(finalData);
    fs.writeFileSync("contentful_users.csv", csv, "utf8");
    console.log("Wrote contentful_users.csv with user + role + team data.");
  } catch (error) {
    console.error("Script error:", error);
  }
})();

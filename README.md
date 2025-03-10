# Contentful Users & Roles Export Script

This Node.js script fetches all users in your Contentful organization, along with their **organization roles**, **space roles**, and any **teams** they belong to, then outputs everything to a CSV file.

---

## Prerequisites

1. Node.js installed (v14+ recommended).
2. A Contentful Management API token with permissions to read:
   - Organization memberships
   - Space memberships
   - Team memberships

---

## Setup

1. Clone or download this repository.

2. Install dependencies:
   npm install

3. Create and configure a .env file:
   - Copy the sample: cp .env.sample .env
   - Open .env and add your actual Contentful Management API token and organization ID:
     CONTENTFUL_MANAGEMENT_API_TOKEN=YOUR_REAL_TOKEN
     CONTENTFUL_ORGANIZATION_ID=YOUR_ORGANIZATION_ID

---

## Usage

Run the script:
node fetch-contentful-users.js

It will generate a contentful_users.csv file containing columns:

userId, email, name, orgRoles, spaceRoles, teams

- userId: The Contentful user’s ID
- email: The user’s email address
- name: The user’s first and last name
- orgRoles: A semicolon-delimited list of organization roles (e.g., "Organization Owner; Editor")
- spaceRoles: A semicolon-delimited list of space roles (e.g., "Admin; Editor")
- teams: A semicolon-delimited list of teams this user belongs to

# Architecture Overview

## Product Summary

This is an all-in-one IoT website for building, documenting, coding, deploying, and monitoring projects in one place.

It combines:

- AI-assisted project development
- Technical document management
- Code editing and project generation
- One-click deploy and release flow
- A Blynk-style user dashboard for devices and widgets
- Admin controls for servers, plans, quotas, and users

## UX Direction

The UI should feel like a mix of:

- Blynk-style dashboard
- Notion-style document hub
- Vercel-style deployment monitor
- Portainer-style server panel
- AI project assistant

The overall experience should feel like a single product that lets a user go from idea to code, from code to deploy, and from deploy to live device dashboard.

### Project Roles

#### Owner

- Project-scoped role
- Owns the project
- Can edit and manage everything in the project
- Can share the dashboard with other people
- Can grant viewer access to the shared dashboard

#### Viewer

- Project-scoped role
- Can only view a shared dashboard
- Cannot edit project code, widgets, deploy settings, or project data

### System Roles

#### Admin

- View server metrics
- Monitor website and service status
- Manage backups
- Manage users
- Change plans and quotas
- Review logs and global settings

#### User

- Read and manage documents
- Create and edit IoT projects
- Use AI for project generation
- Deploy projects to devices or dashboards
- Manage dashboard widgets
- View live device data

## Plan Summary

- Free: 2 projects, limited AI, basic widgets, limited deploys
- Pro: higher quotas, more AI, and advanced widgets
- Max: highest quotas, priority deploys, and advanced monitoring

## Suggested Stack

- Standalone Angular components
- Signals for local state
- NgRx Signal Store for shared state
- RxJS for realtime, polling, MQTT, and WebSocket use cases
- Http interceptors for auth, loading, error, and logging
- Angular CDK for overlay, drag-drop, dialog, and virtual scroll
- Tailwind CSS v4 for UI styling

# Feature Flows

## Admin Server Monitoring

- Page loads metrics
- Store manages state
- Service talks to API
- UI updates from store only

## Database Backup

- Admin opens backup page
- Service creates backup
- Interceptors handle loading and errors
- Logger records the event
- History refreshes after completion

## User Management

- Admin views users
- Store holds user list and filters
- Service handles API calls
- Component does not own user state

## IoT Project Builder

- User clicks create project
- Quota service checks plan limits
- Allowed users open the editor
- Blocked users see upgrade guidance

## AI Assistant

- User submits a prompt
- Assistant service sends it to the backend
- Backend returns research, plan, code, and widgets
- User reviews before any deployment

## Device Dashboard

- Widget renderer uses widget config and data source
- Widgets stay generic and reusable
- Widget types should not depend on editor components

## Example User Flow

- Free user clicks create project
- Quota guard checks project count
- If allowed, open the builder
- If denied, show an upgrade prompt

## Example Admin Flow

- Admin opens backup page
- Admin starts a backup
- Service calls API
- Logger records the result
- History refreshes and the file can be downloaded

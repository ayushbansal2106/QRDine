# MongoDB Atlas Free Tier Setup

Use MongoDB Atlas if you want a free hosted database for QRDine.

## Steps

1. Create a free Atlas account at MongoDB Atlas.
2. Create a new cluster using the free M0 tier.
3. Create a database user with a username and password.
4. Add a network access rule for your current IP, or temporarily allow `0.0.0.0/0` while developing.
5. Open the cluster connection dialog and copy the `mongodb+srv://` connection string.
6. Replace the placeholders with your values and set the database name, for example `qrdine`.
7. Put the final URI into `backend/.env` as `MONGODB_URI=...`.
8. Run the backend from `backend/` with `npm run dev`.

## Example

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb+srv://myUser:myPassword@cluster0.abcd123.mongodb.net/qrdine?retryWrites=true&w=majority
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=7d
```

## Notes

- The backend already uses Mongoose and will connect to whatever URI you provide.
- If the server still fails on startup, the usual causes are a wrong password, a missing IP allowlist rule, or an incorrect cluster host.
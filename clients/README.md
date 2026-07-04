# Client reskins — THE HANDOFF

This is the "bundle. ship. reskin." layer. SAM lives in one repo.
To spin up a version for a specific brand or a client:

1. Copy `default.json` → `<client-id>.json`
2. Change `name`, `accent`, `tagline`, and which skills are enabled
3. Fork the repo (or branch) per client and run `./setup.sh`

Each fork is a fully isolated SAM with its own vault and keys.

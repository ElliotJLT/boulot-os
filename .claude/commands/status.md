# /status

Quick status across all active applications.

1. Ask who (or show both if not specified)
2. Scan all `USER/active/*/status.md` files
3. For each, show:
   - Company | Role | Stage | Last Updated | Next Action | Days Since Update
4. Flag:
   - STALE: >21 days since update, no next action scheduled
   - AGING: 14-21 days since update
   - ACTIVE: <14 days or has upcoming next action
   - DEAD: suggest archiving (rejected/withdrawn/expired)
5. Auto-archive anything marked rejected/withdrawn/expired
6. For stale jobs: "Do you want to follow up, or should I archive this?"

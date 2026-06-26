# /new-job

Start a new job application. Ask for:
1. Who is this for? (defaults to the single user folder, e.g. `USER`; only ask if the vault has multiple user folders)
2. Company name
3. Role title
4. JD (paste or file path)
5. Where did you find it?
6. Application deadline (if known)

Then:
1. Create folder at `USER/active/{company-slug}/`
2. Create `job.md` with JD, role details, source
3. Create `status.md` with:
   - stage: researching
   - applied_date: [today or blank]
   - last_updated: [today]
   - next_action_date: [deadline or today + 7 days]
   - source: [where found]
4. Spawn agent team:
   - **Researcher**: Web search company, recent news, funding, team, Glassdoor. Write to `research.md`
   - **JD Analyst**: Parse JD requirements, map against `USER/cv-master.md`, identify fits and gaps. Write initial `cv.md` draft
   - **Tracker**: Check if similar roles exist in archive (applied before?), flag any conflicts with active applications
5. Once agents complete, synthesise findings and present:
   - "Here's what I found. Here are your strongest fits. Here are the gaps. Want me to generate a tailored CV?"

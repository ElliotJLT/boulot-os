# /prep

Prepare for an upcoming interview.

1. Identify user and job
2. Read all files in `USER/active/{company}/`
3. Read relevant stories from `USER/stories/`
4. Check what stage we're at from `status.md`
5. If previous calls exist in `calls/`, read them for continuity
6. Spawn agent team:
   - **Question Generator**: Based on JD, stage, company research, and previous calls, generate 15-20 likely questions. Categorise: background, technical, situational, curveball
   - **Answer Drafter**: For each question, draft a 60-90 second answer pulling from cv-master and stories. Flag where answer is weak or generic.
   - **Gap Analyst**: Identify the 3-5 biggest gaps between candidate and role. For each, draft an honest acknowledgment + bridge ("I haven't done X, but here's the closest analogue + how I'd close the gap")
7. Compile into updated `prep.md`
8. Offer to run a mock interview (quiz mode — ask questions, evaluate answers, push back on weak responses)

After the interview:
- Ask how it went, what was asked, what landed, what didn't
- Update `prep.md` with learnings
- Update `status.md` with new stage and next steps
- If there's a transcript (e.g., from Granola), process it into `calls/` folder

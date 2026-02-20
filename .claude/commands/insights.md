---
allowed-tools: Bash(curl:*), Read
description: Quick read-only viewer showing top insights ranked by source count
---

# Insights Viewer

Show the top insights from the insight tracking system.

## Steps

1. Fetch insights from the API:

```bash
curl -s http://localhost:3100/api/insights/stats | python3 -m json.tool
```

2. Display the stats summary (total insights, total sources, top insight).

3. Fetch top 20 insights:

```bash
curl -s "http://localhost:3100/api/insights?sort=source_count&limit=20" | python3 -m json.tool
```

4. Format the results as a readable table:
   - Rank | Insight text (truncated) | Category | Sources | Last seen
   - Sort by source_count descending

5. If the user wants to filter by category, refetch with the category parameter.

6. Point the user to the WebUI Insights tab for interactive browsing: http://localhost:3100 (Insights tab under Operations).

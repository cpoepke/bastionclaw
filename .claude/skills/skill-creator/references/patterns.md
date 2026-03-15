# Skill Design Patterns

## Pattern 1: Sequential Workflow

Steps execute in strict order. Each step depends on the previous.

```
Step 1: Fetch data → customer_id
   ↓
Step 2: Process data → needs customer_id
   ↓
Step 3: Store results → needs processed data
   ↓
Step 4: Notify → needs storage confirmation
```

**When to use:** Automated pipelines, data processing, onboarding flows
**Key rules:**
- Each step passes data to the next (via JSON files in `.tmp/`)
- Validate output before moving to next step
- If any step fails, stop and report (don't skip)

**Examples:** email-digest, research-lead

---

## Pattern 2: Iterative Refinement

Generate output, validate, fix issues, repeat until quality passes.

```
1. Generate initial output
   ↓
2. Run validation (script or checklist)
   ↓
3. Issues found?
   → Yes: Fix specific issues, go to step 2
   → No: Finalize output
```

**When to use:** Content generation, document creation, code quality
**Key rules:**
- Validation must be machine-verifiable (scripts, not vibes)
- Set max iteration count (3-5 rounds) to avoid infinite loops
- Each round should fix fewer issues (convergence)

---

## Pattern 3: Multi-MCP Coordination

Workflow spans multiple external services, orchestrated in phases.

```
Phase 1: Notion MCP → Extract project data
   ↓
Phase 2: Google Drive MCP → Create folder, upload assets
   ↓
Phase 3: Slack MCP → Post summary with links
```

**When to use:** Cross-service workflows
**Key rules:**
- Use fully qualified MCP tool names
- Can't start Phase N+1 until Phase N completes
- Prefer Python scripts over MCP for steps that don't need live reasoning

---

## Pattern 4: Context-Aware Branching

Same skill, different execution path based on input.

```
Input received → Check type
├── If code → Code review path
├── If document → Document processing path
└── If spreadsheet → Data analysis path
```

**When to use:** File processors, multi-format handlers, routing skills
**Key rules:**
- Detection logic at top of SKILL.md or first script
- Each branch is self-contained
- Clearly document which branch handles which input

---

## Pattern 5: Domain-Specific Intelligence

Embedded business rules, compliance checks, decision frameworks.

```
Input → Apply business rules → Decision logic → Audit trail
```

**When to use:** Regulated industries, compliance, risk assessment
**Key rules:**
- Business rules in reference files (easily updated)
- Decision logic should be deterministic (Python, not Claude judgment)
- Always create audit trail

---

## Combining Patterns

Most real skills combine 2-3 patterns:
- **email-digest** = Sequential + Domain-specific (irate detection)
- **research-lead** = Sequential + Iterative (DM quality check)
- **build-website** = Sequential + Iterative (design refinement) + Domain-specific (performance)

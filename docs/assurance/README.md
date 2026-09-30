# BrainBase Assurance

BrainBase Assurance is where an organisation records what went wrong or was
checked, what was found, what is being done about it, and the proof that it
was fixed.

It brings incidents, investigations, inspections and audits into one
controlled chain of findings, corrective actions, evidence and independent
verification. Each step is recorded against a named person and time.

This folder is the **living documentation** for the module. It describes
the behaviour that is implemented today — nothing more.

These same files are the **in-app Help**: Assurance → **Help & work
instructions** (at the bottom of the Assurance navigation) renders them
directly, with search, and every Assurance page has a **Help** link to the
most relevant guide section or work instruction. There is no second copy of
the text.

| Document | For |
|---|---|
| [User guide](user-guide.md) | Everyone who uses Assurance day to day |
| [Admin guide](admin-guide.md) | Organisation admins and BrainBase super admins |
| [Work instructions](work-instructions/) | Step-by-step procedures to follow while doing a task |
| [Change log](change-log.md) | What changed for users, release by release |

## The Assurance lifecycle

```
Capture → Triage → Investigate / Assess → Find → Act → Evidence → Verify → Close → Learn
```

| Stage | What happens in BrainBase |
|---|---|
| **Capture** | An incident is reported, or an inspection or audit is planned. |
| **Triage** | The incident is reviewed and its next step is chosen (investigation, action or verification). |
| **Investigate / Assess** | An investigation examines one or more incidents; an inspection or audit is run and responses are recorded. |
| **Find** | Someone explicitly raises a **finding** — a hazard, defect, non-conformance, observation or opportunity. |
| **Act** | One or more **corrective actions** are created against the finding, with an owner and due date. |
| **Evidence** | Proof is recorded and linked (what it is and where the original is held). |
| **Verify** | A person who did not own or do the work independently confirms whether it genuinely worked. |
| **Close** | Actions, findings, incidents and investigations are each closed explicitly, by a person, when their own rules are met. |
| **Learn** | The dashboard, registers, verification history and audit recommendations show patterns and what still needs attention. |

## Sections

Assurance appears in the BrainBase top navigation for organisations that have
it enabled. Inside the module, the left navigation has nine sections:

| Section | What it is for |
|---|---|
| **Dashboard** | "What needs attention?" — overdue work, verification queue, serious incidents, due inspections and audits. |
| **Incidents** | Reported events, near misses and service failures. |
| **Investigations** | Structured examination of one or more incidents, ending in a recorded conclusion. |
| **Inspections** | Operational checks, from a checklist template or ad hoc. Templates are reached from here. |
| **Audits** | Structured reviews against a standard or requirement, from a criteria template or ad hoc. Templates are reached from here. |
| **Findings** | Every identified issue and where it came from. |
| **Actions** | Corrective actions (the register is titled "Corrective actions"). |
| **Evidence** | Every evidence record and what it is linked to. |
| **Verification** | The queue of actions awaiting independent verification, and recent decisions. |

## Key concepts

- **Incident** — something that happened (an injury, near miss,
  environmental event, service failure and so on). It is triaged through
  explicit status steps and closed with a closure summary.
- **Investigation** — an examination of what happened. One investigation
  can cover several incidents, and one incident can be examined by several
  investigations. It ends with a recorded conclusion.
- **Inspection** — a planned or ad hoc check. Each item gets a response (for
  example Pass, Fail, Observation or N/A).
- **Audit** — a review against a named standard or reference. Each
  criterion is rated (Compliant, Partially compliant, Non-compliant, N/A or
  Observation).
- **Finding** — an identified issue that needs a decision. It remembers its
  source (incident, investigation, inspection item or audit criterion).
- **Action** — the corrective work that responds to one or more findings,
  with an owner, priority and due date.
- **Evidence** — a record of proof: its type, what it shows, and where the
  original is held. One evidence record can support several records.
- **Verification** — an independent person's recorded judgement of whether
  an action's work genuinely resolved the issue.

## The assurance chain

```
Source → Finding → Action → Evidence → Verification → Closure
```

Finding and action pages show this chain as a strip at the top, with each
step marked as done, current, pending or blocked.

The rules that hold the chain together:

- **Completion and closure are different.** Marking an action's work
  complete, completing an inspection, audit or investigation, and accepting a
  verification do not close anything. Closure is always its own explicit step.
- **Evidence does not close work.** Linking evidence only satisfies an
  action's evidence requirement.
- **Verification is independent confirmation.** The action's owner, and
  anyone who has marked its work complete, cannot verify it. An accepted
  verification makes the action ready to close; it does not close it.
- **Template versions are immutable.** Changing an inspection checklist or
  audit criteria publishes a new version. Inspections and audits keep the
  exact version they were planned with.
- **Nothing is closed on another record's behalf.** Closing an action does
  not close its finding; closing a finding does not close its incident,
  investigation, inspection or audit; completing an investigation does not
  close its incidents. Closure is refused while dependent work is still open
  (see the user guide).
- **No shortcuts.** Audit and inspection results never create findings by
  themselves, and an audit cannot create an action directly. Corrective work
  always runs through a finding.

## Documentation maintenance

Any change to Assurance that alters:

- user workflow
- visible UI
- labels
- permissions
- statuses
- record relationships
- closure or verification behaviour

**must update the relevant guide or work instruction in the same development
phase**, and add a user-facing entry to the [change log](change-log.md).

Documentation is part of the definition of done for an Assurance change.
Describe only what is implemented. Deferred features go in the "Current
limitations" sections, not in procedures.

Because these files are rendered as in-app Help:

- **New document** — register it in `lib/assurance/help/registry.ts` (slug,
  file, group). A test fails if a Markdown file here is not registered.
- **Headings are link targets.** Each page's **Help** link points at a
  heading anchor (`lib/assurance/help/topics.ts`). If you rename or reorder a
  heading that a topic uses, update the topic — a test fails if any target is
  missing.
- **Links** between documents are relative (`user-guide.md`,
  `work-instructions/07-add-and-link-evidence.md`, `#anchor`). Only
  registered documents, same-page anchors and `https://` links are
  rendered as links; a test fails if a written link does not resolve.
- **Supported formatting only:** headings, paragraphs, `-` and `1.` lists
  (nested by indentation), tables, `>` notes, fenced code blocks, `---`,
  **bold**, `code` and links. Anything else (HTML, images, other
  emphasis) is shown as plain text, never as markup.
- Never put secrets, credentials or connection strings in these files — they
  are shown to every user with Assurance access.

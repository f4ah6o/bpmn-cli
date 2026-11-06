---
name: bpmn-cli
description: Use this skill when authoring, editing, validating, laying out, or exporting BPMN 2.0 diagrams with the bpmn-cli command. Covers the CLI workflow, diagram readability rules, DI generation, and style validation. For Camunda 8 executable processes, also use the official camunda-bpmn skill.
---

# bpmn-cli authoring skill

The installed CLI prints this document with:

~~~bash
bpmn skill
bpmn skill --format json
~~~

## Scope

This skill covers generic BPMN 2.0 authoring with **bpmn-cli**:

- create and edit process structure
- generate BPMN DI with bpmn layout
- validate with bpmnlint and the CLI style checks
- export a browserless SVG

It does **not** cover Camunda 8 execution metadata such as Zeebe task
definitions, FEEL forms, connectors, or deployment. For executable Camunda 8
processes, also use the official camunda-bpmn skill:

https://github.com/camunda/skills/blob/main/skills/camunda-bpmn/SKILL.md

## Standard workflow

1. Inspect an existing file before changing it.
2. Build the process with the CLI. Do not hand-edit generated DI.
3. Run layout to create coordinates and DI.
4. Validate structure and readability.
5. Export SVG only after validation.

~~~bash
bpmn list process.bpmn --format json
bpmn add start process.bpmn --id Start --name "開始"
bpmn add task process.bpmn --id Review --name "申請を確認する" --type user
bpmn add end process.bpmn --id End --name "終了"
bpmn connect process.bpmn Start Review
bpmn connect process.bpmn Review End
bpmn layout process.bpmn --force
bpmn validate process.bpmn --style
bpmn export-svg process.bpmn --output process.svg --force
~~~

For a new file, use bpmn init first. For edits, preserve existing DI unless a
relayout is explicitly required; bpmn layout needs --force to replace DI.

## Modeling rules

### Structure

- Every path starts at a Start Event and reaches an End Event.
- Every element must be on a complete path; avoid disconnected nodes.
- Use one clear start and end per process unless the business process needs
  multiple trigger or outcome events.
- Use explicit gateways for splits and joins. Avoid implicit splits.
- A join gateway must match the corresponding fork type.
- Use descriptive, unique PascalCase IDs.

### Naming

- Tasks: verb + object, for example "Review invoice".
- Events: the outcome or trigger, for example "Invoice received".
- Gateways: a question, for example "Amount over limit?".
- Do not leave user-visible elements unnamed.
- Conditions and non-default flows should be labeled.

### Gateways

- Exclusive gateway: choose exactly one path and set a default flow for the
  fallback. Do not create an XOR where every outgoing flow has a condition and
  no default exists.
- Parallel gateway: all branches run; use a matching parallel join.
- Inclusive gateway: one or more branches run; use a matching join.
- Do not use a gateway as a pass-through when it has one incoming and one
  outgoing flow.

### Readability

- Lay out the happy path from left to right.
- Avoid crossing sequence flows.
- Do not overlap flow-node shapes.
- Keep spacing consistent; use bpmn layout rather than hand-edited coordinates.
- Make loops explicit and keep the return path visually separate.
- Prefer a compact diagram with a clear main path over a dense graph.

### DI and output

- Generate DI with bpmn layout.
- Do not invent or hand-edit BPMN DI coordinates for a normal edit.
- Use bpmn export-svg for the final browserless SVG.

## Validation

~~~bash
bpmn validate process.bpmn
bpmn validate process.bpmn --style
bpmn validate process.bpmn --style --format json
~~~

bpmn validate runs bpmnlint plus structural checks. With **--style**, the CLI
also reports:

| Rule | Meaning |
|---|---|
| style/flow-direction | A non-loop sequence flow runs right-to-left |
| style/flow-crossing | Two sequence flows cross |
| style/element-overlap | Two flow-node shapes overlap |
| style/gateway-default | A multi-outgoing XOR/OR gateway has no default |
| style/no-di | Style geometry cannot be checked without DI |

Style findings are warnings or info, so they do not change the process exit
code. Review and fix them before considering the diagram done. For a clean
result, run layout first and then bpmn validate --style.

## Working with existing BPMN

- Read the relevant section with bpmn list --format json before editing.
- Use the CLI for semantic edits so incoming/outgoing references and DI stay
  coherent.
- If DI exists and the structure changed, either preserve it deliberately or
  relayout with bpmn layout --force.
- Run bpmn validate --style after edits and before export.

## References

- Camunda Best Practices, Creating readable process models:
  https://docs.camunda.io/docs/components/best-practices/modeling/creating-readable-process-models/
- bpmnlint:
  https://github.com/bpmn-io/bpmnlint
- Official Camunda BPMN skill:
  https://github.com/camunda/skills/blob/main/skills/camunda-bpmn/SKILL.md

## Completion gate

A normal bpmn-cli task is complete when:

- bpmn validate reports no errors
- bpmn validate --style has been reviewed and has no unexpected findings
- the BPMN source is saved
- the SVG has been generated when requested

# Saved state from v3

`v3-group-state.json` is unmodified state emitted by CLI 3.11.0 at commit
`b88f3981989c3cc7a06efea2597807517a624d16`. It is not hand constructed.

The project used flat rules and these features:

| Feature     | Rule key  | Percentage | Variation weights        |
| ----------- | --------- | ---------- | ------------------------ |
| experimentA | legacy    | 50         | control 50, treatment 50 |
| experimentB | legacy    | 50         | control 50, treatment 50 |
| unrelated   | unchanged | 35         | control 60, treatment 40 |

Each feature had `bucketBy: userId`, `tags: [all]`, and `segments: '*'` on its
rule. A Group assigned experimentA and experimentB 50 percent each, in that
order. Build the project with the v3 CLI to produce this state. The generated
datafile contains Group ranges, but the state writer does not record them.

The regression test loads these bytes from disk. It demonstrates the invalid
variation coverage when old rule keys are retained, then the repair through
new rule keys while preserving the unrelated feature's state.

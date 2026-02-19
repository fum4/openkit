# This document outlines new features, improvements and fixes related to agents

## Fix code review (skill) reported issues

It looks like the agent will fix issues reported by the code review skill if used as a hook. Thats good, but lets make sure we actually instruct agents to do this, it should be reliable

## ✅ Proper handling of git policy

Having commits/push/pr disabled will not 100% stop claude from commiting (especially commits) -- should enforce the constraint (reproduced this only when using /work skill directly)

## Refine default agent configuration

Make sure the out of the box configuration for agent behavior is solid and well refined (e.g. use code-review plugin from anthropic instead of custom one?)

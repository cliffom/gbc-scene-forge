# Standalone editor seeds

Synthetic terrain and sprite artwork comes from `tests/support/atlas_fixture.py`. The actor
manifest includes the directional sequences authored by the import acceptance
scenario. `project/` is a portable two-scene project: Village contains saved mixed
artwork; River contains one saved sprite. No drafts or transaction history is
retained. `input/` and `sprites/` are independent import sources used for reimport
and removed before the moved-project restart check.

The preview and layer scenarios copy this project into their own workspace, clear
River's sprite through the backend, then place and save it through native browser
input. This establishes a real undoable placement without rerunning import checks.
The layer scenario loads `layer-preview.json` to exercise persisted preferences
independently of the preview scenario. Each test owns its servers and contexts.

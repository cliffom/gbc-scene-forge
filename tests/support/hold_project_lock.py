"""Hold a real project lock until stdin releases it; synchronize cross-process tests."""

import sys
from contextlib import ExitStack

from project_busy import retry_busy

from gbc_scene_forge.project.application import Project

project = retry_busy(lambda: Project(sys.argv[1]))
with ExitStack() as held:
    retry_busy(lambda: held.enter_context(project.transactions.locked()))
    print("locked", flush=True)
    if sys.stdin.readline().strip() != "release":
        raise RuntimeError("Expected explicit lock release")

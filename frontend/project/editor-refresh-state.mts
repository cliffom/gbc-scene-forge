/** Refresh eligibility tracks saved identity and interaction, never a rendered object identity. */
import type { SceneSession, WorkspaceState } from '../editor/editor-state.mts';

export class ExternalRefreshState {
  request = false;
  epoch = 0;
  readonly pointers = new Set<number>();

  capture(
    scene: Pick<SceneSession, 'loaded' | 'editor'>,
    workspace: Pick<WorkspaceState, 'revision'>,
  ) {
    return {
      epoch: this.epoch,
      sceneId: scene.loaded?.id,
      sceneRevision: scene.loaded?.revision,
      revision: workspace.revision,
      editor: scene.editor,
    };
  }
  matches(
    before: ReturnType<ExternalRefreshState['capture']>,
    scene: Pick<SceneSession, 'loaded' | 'editor'>,
    workspace: Pick<WorkspaceState, 'revision'>,
  ) {
    return (
      this.epoch === before.epoch &&
      scene.loaded?.id === before.sceneId &&
      scene.loaded?.revision === before.sceneRevision &&
      scene.editor === before.editor &&
      workspace.revision === before.revision
    );
  }
}

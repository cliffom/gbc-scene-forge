import type { EditorLifetime } from '../editor/editor-lifetime.mts';
import type { createAnimationPreview } from '../preview/animation-preview.mts';
import { array, record, string } from '../shared/decode.mts';
import { button, element, form, input, select } from '../editor/editor-dom.mts';
import type { createEditorLayout } from '../editor/editor-layout.mts';
import type { WorkspaceState } from '../editor/editor-state.mts';
import type { createFirstSceneGuide } from './first-scene-guide.mts';
import { decodePreviewSettings } from '../preview/preview-settings.mts';
import type { ProjectApi } from './project-api.mts';
import { decodeProject } from './project-contracts.mts';

export interface Ports {
  image: (id: string) => HTMLImageElement | undefined;
  replaceImages: (images: ReadonlyMap<string, HTMLImageElement>) => void;
  showImport: (reimport?: boolean) => void;
  showDeleteAtlas: (id: string) => void;
  palette: (chooseInitial?: boolean) => void;
  run: (work: () => Promise<void> | void) => Promise<void>;
  blockoutView: {
    sync: () => void;
    showCreate: () => void;
    closeCreate(): void;
    present(value: unknown): void;
  };
}
export function createWorkspaceController({
  lifetime,
  workspaceState,
  api,
  projectBase,
  request,
  transport,
  animationPreview,
  status,
  editorLayout,
  firstSceneGuide,
  ports,
}: {
  lifetime: EditorLifetime;
  workspaceState: Pick<
    WorkspaceState,
    | 'sceneChoices'
    | 'choosingProject'
    | 'hasProjectChoices'
    | 'navigating'
    | 'previewSettingsLoaded'
    | 'project'
    | 'revision'
  >;
  api: ProjectApi['json'];
  projectBase: string;
  request: ProjectApi['request'];
  transport: ProjectApi;
  animationPreview: ReturnType<typeof createAnimationPreview>;
  status: HTMLElement;
  editorLayout: ReturnType<typeof createEditorLayout>;
  firstSceneGuide: ReturnType<typeof createFirstSceneGuide>;
  ports: Ports;
}) {
  let projectFormTouched = false;
  for (const event of ['input', 'change']) {
    form('project-form').addEventListener(
      event,
      () => {
        projectFormTouched = true;
      },
      { signal: lifetime.signal },
    );
  }

  function showProjectStart(creating: boolean) {
    element('project-picker', HTMLElement).hidden = workspaceState.project !== null || creating;
    form('project-form').hidden = workspaceState.project !== null || !creating;
    button('back-to-projects').hidden = !workspaceState.hasProjectChoices;
  }

  const folderPopover = element('folder-popover', HTMLElement);

  function positionFolderPopover() {
    if (!folderPopover.matches(':popover-open')) {
      return;
    }
    const trigger = button('project-folder').getBoundingClientRect();
    const panel = folderPopover.getBoundingClientRect();
    folderPopover.style.left = `${Math.max(16, Math.min(trigger.right - panel.width, innerWidth - panel.width - 16))}px`;
    folderPopover.style.top = `${Math.max(16, Math.min(trigger.bottom + 8, innerHeight - panel.height - 16))}px`;
  }

  folderPopover.addEventListener(
    'toggle',
    () => {
      element('folder-copy-status', HTMLElement).textContent = '';
      positionFolderPopover();
    },
    { signal: lifetime.signal },
  );

  window.addEventListener('resize', positionFolderPopover, { signal: lifetime.signal });

  lifetime.assign(button('copy-folder'), 'onclick', async () => {
    const copy = button('copy-folder');
    const feedback = element('folder-copy-status', HTMLElement);
    copy.disabled = true;
    try {
      await navigator.clipboard.writeText(element('folder-path', HTMLElement).textContent || '');
      feedback.textContent = 'Path copied.';
    } catch {
      feedback.textContent = 'Copy unavailable. Select the path above to copy it.';
    } finally {
      copy.disabled = false;
      positionFolderPopover();
    }
  });

  lifetime.assign(button('show-new-project'), 'onclick', () => {
    projectFormTouched = true;
    showProjectStart(true);
    input('project-title').focus();
  });

  lifetime.assign(button('back-to-projects'), 'onclick', () => {
    showProjectStart(false);
    button('show-new-project').focus();
  });

  // Choice inventories never adopt project state or acknowledge saved revisions.
  // In particular they may update while the active editor is dirty.
  async function refreshChoices(eligible: () => boolean) {
    if (!eligible() || (!workspaceState.project && !workspaceState.choosingProject)) {
      return;
    }
    const revision = workspaceState.revision;
    const current = () => eligible() && !lifetime.disposed && revision === workspaceState.revision;
    try {
      const root =
        workspaceState.choosingProject || Boolean(projectBase)
          ? record(await (await request('project', undefined, 10000, '')).json())
          : null;
      const inventory = workspaceState.project ? await api('choices', record) : null;
      // Decode every entry before mutating any visible choices.
      const projects = root
        ? array(root.projects, record).map((item) => ({
            directory: string(item.directory),
            name: string(item.name),
          }))
        : [];
      const scenes = inventory
        ? array(inventory.scenes, record).map((item) => ({
            id: string(item.id),
            name: string(item.name),
          }))
        : [];
      const errors = [
        ...(root
          ? array(root.unavailable, record).map(
              (item) => `${string(item.directory)}: ${string(item.error)}`,
            )
          : []),
        ...(inventory
          ? array(inventory.unavailable, record).map(
              (item) => `Scene ${string(item.id)}: ${string(item.error)}`,
            )
          : []),
      ];
      if (!current()) {
        return;
      }
      const replaceOptions = (control: HTMLSelectElement, choices: HTMLOptionElement[]) => {
        const previous = control.value;
        const signature = (items: HTMLOptionElement[]) =>
          JSON.stringify(items.map((item) => [item.value, item.text, item.disabled]));
        // Keep a currently loaded/selected item until explicit navigation, even if
        // its saved file is temporarily incomplete or removed by an external writer.
        const selected = Array.from(control.options).find((item) => item.value === previous);
        if (selected && previous && !choices.some((item) => item.value === previous)) {
          choices.push(new Option(selected.text, previous));
        }
        if (signature(Array.from(control.options)) !== signature(choices)) {
          control.replaceChildren(...choices);
          control.value = previous;
        }
      };
      if (root && projectBase) {
        replaceOptions(select('switch-project'), [
          ...projects.map(
            (item) => new Option(item.name, `/projects/${encodeURIComponent(item.directory)}`),
          ),
          new Option('Choose or create project…', '/'),
        ]);
      }
      if (inventory) {
        workspaceState.sceneChoices = scenes;
        select('scenes').disabled = scenes.length === 0;
        const placeholder = new Option('Choose a scene…', '');
        placeholder.disabled = true;
        replaceOptions(select('scenes'), [
          placeholder,
          ...scenes.map((item) => new Option(item.name, item.id)),
        ]);
      }
      if (root && workspaceState.choosingProject) {
        const list = element('project-list', HTMLElement);
        const signature = JSON.stringify(projects);
        if (list.dataset.inventory !== signature) {
          const links = projects.map((item) => {
            const link = document.createElement('a');
            link.className = 'project-card';
            link.href = `/projects/${encodeURIComponent(item.directory)}/`;
            link.title = item.directory;
            const title = document.createElement('strong');
            title.textContent = item.name;
            link.append(title);
            return link;
          });
          list.replaceChildren(...links);
          list.dataset.inventory = signature;
        }
        element('unavailable-projects', HTMLElement).textContent = errors.join(' · ');
        workspaceState.hasProjectChoices = projects.length > 0 || errors.length > 0;
        button('back-to-projects').hidden = !workspaceState.hasProjectChoices;
        // An empty-root startup displays the creation form. Reveal discoveries
        // without dismissing an explicit creation flow or unfinished input.
        if (
          workspaceState.hasProjectChoices &&
          !projectFormTouched &&
          !input('project-title').value &&
          !form('project-form').contains(document.activeElement)
        ) {
          showProjectStart(false);
        }
      }
      const notice = element('inventory-status', HTMLElement);
      notice.textContent = errors.join(' · ');
      notice.hidden = errors.length === 0;
    } catch (error) {
      if (!current()) {
        return;
      }
      const notice = element('inventory-status', HTMLElement);
      notice.textContent = `Project/scene discovery unavailable; keeping current choices. ${error instanceof Error ? error.message : String(error)}`;
      notice.hidden = false;
    }
  }

  async function refresh(
    supplied?: Record<string, unknown>,
    canApply?: () => Promise<boolean>,
  ): Promise<boolean> {
    const data = supplied ?? (await api('project', record));
    // Stage every asynchronous dependency before touching the displayed snapshot.
    const nextImages = new Map<string, HTMLImageElement>();
    const decoded = data.project === null ? null : decodeProject(data.project);
    const sceneChoices = decoded
      ? array((await api('choices', record)).scenes, record).map((item) => ({
          id: string(item.id),
          name: string(item.name),
        }))
      : [];
    for (const [id, atlas] of Object.entries(decoded?.atlases ?? {})) {
      const existing =
        supplied && data.revision === workspaceState.revision ? ports.image(id) : undefined;
      if (existing) {
        nextImages.set(id, existing);
        continue;
      }
      const image = new Image();
      image.src = `${projectBase}/${atlas.png}?revision=${encodeURIComponent(string(data.revision))}`;
      await image.decode();
      nextImages.set(id, image);
    }
    const projectChoices =
      projectBase && !supplied
        ? record(await (await request('project', undefined, 30000, '')).json())
        : null;
    if (lifetime.disposed || (canApply && !(await canApply()))) {
      return false;
    }
    transport.token = string(data.token);
    workspaceState.choosingProject = Array.isArray(data.projects);
    const folderPath = string(
      workspaceState.choosingProject ? data.project_root : data.project_path,
    );
    const folderLabel = workspaceState.choosingProject ? 'Projects folder' : 'Project folder';
    element('folder-path', HTMLElement).textContent = folderPath;
    element('folder-name', HTMLElement).textContent =
      folderPath.split(/[\\/]/).filter(Boolean).at(-1) || folderPath;
    element('folder-heading', HTMLElement).textContent = folderLabel;
    button('project-folder').disabled = false;
    button('project-folder').setAttribute('aria-label', `${folderLabel}: ${folderPath}`);
    button('project-folder').title = folderLabel;
    element('folder-copy-status', HTMLElement).textContent = '';
    if (workspaceState.choosingProject) {
      const list = element('project-list', HTMLElement);
      list.replaceChildren();
      for (const value of array(data.projects, record)) {
        const link = document.createElement('a');
        link.className = 'project-card';
        link.href = `/projects/${encodeURIComponent(string(value.directory))}/`;
        const title = document.createElement('strong');
        title.textContent = string(value.name);
        link.title = string(value.directory);
        link.append(title);
        list.append(link);
      }
      list.dataset.inventory = JSON.stringify(
        array(data.projects, record).map((item) => ({
          directory: string(item.directory),
          name: string(item.name),
        })),
      );
      const unavailable = element('unavailable-projects', HTMLElement);
      unavailable.replaceChildren();
      for (const value of array(data.unavailable, record)) {
        const message = document.createElement('p');
        message.textContent = `${string(value.directory)}: ${string(value.error)}`;
        unavailable.append(message);
      }
      workspaceState.hasProjectChoices =
        list.children.length > 0 || unavailable.children.length > 0;
    }
    if ((!workspaceState.previewSettingsLoaded || supplied) && data.project !== null) {
      const saved = record(record(data.project).preview).sprite;
      if (saved !== undefined) {
        animationPreview.restore(decodePreviewSettings(saved));
      }
      workspaceState.previewSettingsLoaded = true;
    }
    workspaceState.project = decoded;
    workspaceState.sceneChoices = sceneChoices;
    const previousStamp = select('stamps').value;
    select('stamps').replaceChildren(
      new Option('Choose stamp…', ''),
      ...(workspaceState.project?.stamps.map((s) => new Option(s.name, s.id)) ?? []),
    );
    select('stamps').value = workspaceState.project?.stamps.some((s) => s.id === previousStamp)
      ? previousStamp
      : '';
    const projects = select('switch-project');
    if (!supplied || !projectBase) {
      projects.replaceChildren(
        new Option(workspaceState.project?.name || 'Current project', projectBase),
      );
    }
    if (projectChoices) {
      projects.replaceChildren(
        ...array(projectChoices.projects, record).map(
          (item) =>
            new Option(
              string(item.name),
              `/projects/${encodeURIComponent(string(item.directory))}`,
            ),
        ),
        new Option('Choose or create project…', '/'),
      );
    }
    projects.value = projectBase;
    workspaceState.revision = data.project === null ? '' : string(data.revision);
    showProjectStart(!workspaceState.hasProjectChoices);
    element('project-start', HTMLElement).hidden = workspaceState.project !== null;
    element('workspace', HTMLElement).hidden = workspaceState.project === null;
    if (!workspaceState.project && !workspaceState.hasProjectChoices) {
      input('project-title').focus();
    }
    element('project-name', HTMLElement).textContent =
      workspaceState.project?.name ||
      (workspaceState.choosingProject ? 'Your projects' : 'Create a project');
    document.title = `${workspaceState.project?.name || (workspaceState.choosingProject ? 'Projects' : 'New project')} · Scene Forge`;
    const previous = select('scenes').value;
    const placeholder = new Option('Choose a scene…', '');
    placeholder.disabled = true;
    select('scenes').replaceChildren(
      placeholder,
      ...sceneChoices.map((scene) => new Option(string(scene.name), string(scene.id))),
    );
    select('scenes').value = workspaceState.project?.scenes.some((item) => item.id === previous)
      ? previous
      : '';
    ports.replaceImages(nextImages);
    const filter = select('atlas-filter');
    const previousAtlas = filter.value;
    filter.replaceChildren(
      new Option('All atlases', ''),
      ...Object.keys(workspaceState.project?.atlases || {}).map((id) => new Option(id, id)),
    );
    filter.value = workspaceState.project?.atlases[previousAtlas] ? previousAtlas : '';
    const atlasList = element('atlas-list', HTMLElement);
    atlasList.replaceChildren();
    for (const [id, atlas] of Object.entries(workspaceState.project?.atlases || {})) {
      const row = document.createElement('div');
      row.className = 'atlas-row';
      const label = document.createElement('span');
      label.textContent = `${id} · ${atlas.regions.length} ${atlas.regions.length === 1 ? 'region' : 'regions'}`;
      label.title = id;
      const update = document.createElement('button');
      update.type = 'button';
      update.className = 'small';
      update.textContent = 'Update';
      lifetime.assign(update, 'onclick', () => ports.showImport(true));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'small';
      remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete atlas ${id}`);
      remove.dataset.deleteAtlas = id;
      lifetime.assign(remove, 'onclick', () => ports.showDeleteAtlas(id));
      const actions = document.createElement('div');
      actions.className = 'atlas-actions';
      actions.append(update, remove);
      row.append(label, actions);
      atlasList.append(row);
    }
    if (!atlasList.children.length) {
      atlasList.textContent = 'No atlases imported yet.';
    }
    ports.palette(!supplied);
    return true;
  }

  lifetime.assign(form('project-form'), 'onsubmit', (event) => {
    event.preventDefault();
    void ports.run(async () => {
      const continuingGuide = input('continue-guide').checked;
      const startingBlockout = select('project-starter').value === 'blockout';
      const result = await api('create-project', record, {
        name: input('project-title').value,
        starter: select('project-starter').value,
      });
      if (workspaceState.choosingProject) {
        workspaceState.navigating = true;
        location.assign(
          `/projects/${encodeURIComponent(string(result.directory))}/${startingBlockout ? '?blockout=1' : continuingGuide ? '?guide=1' : ''}`,
        );
        return;
      }
      if (!(await refresh()) || lifetime.disposed) {
        return;
      }
      status.textContent = 'Project created. Choose a scene or create your own.';
      if (startingBlockout) {
        editorLayout.showLibrary('blockout');
        ports.blockoutView.showCreate();
      } else if (continuingGuide) {
        firstSceneGuide.continueInProject();
      }
    });
  });
  return { refresh, refreshChoices };
}

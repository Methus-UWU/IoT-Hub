import { Service } from '@angular/core';
import type * as monaco from 'monaco-editor';

/**
 * Monaco text models and view states that outlive one editor instance.
 *
 * The editor is destroyed whenever the user leaves the IDE route. Keeping the models here
 * means coming back restores the same document with its undo history, cursor, selection,
 * and scroll position instead of a fresh model scrolled to line one.
 *
 * Only types are imported, so injecting this from the shell (to clear it on sign-out)
 * does not pull Monaco into the shell's bundle. Keys are the editor's model paths,
 * `projectId/filename`, so `retain` can drop every other project's models.
 */
@Service()
export class MonacoModelCache {
  private readonly models = new Map<string, monaco.editor.ITextModel>();
  private readonly viewStates = new Map<string, monaco.editor.ICodeEditorViewState>();

  model(path: string): monaco.editor.ITextModel | undefined {
    const model = this.models.get(path);
    if (model?.isDisposed()) {
      this.models.delete(path);
      return undefined;
    }
    return model;
  }

  storeModel(path: string, model: monaco.editor.ITextModel): void {
    this.models.set(path, model);
  }

  viewState(path: string): monaco.editor.ICodeEditorViewState | undefined {
    return this.viewStates.get(path);
  }

  storeViewState(path: string, state: monaco.editor.ICodeEditorViewState | null): void {
    if (state) this.viewStates.set(path, state);
  }

  /** Drops one file's model, e.g. after the file was deleted. */
  dispose(path: string): void {
    this.models.get(path)?.dispose();
    this.models.delete(path);
    this.viewStates.delete(path);
  }

  /** Keeps the models whose path starts with `prefix` and disposes the rest. */
  retain(prefix: string): void {
    for (const path of [...this.models.keys(), ...this.viewStates.keys()]) {
      if (!path.startsWith(prefix)) this.dispose(path);
    }
  }

  clear(): void {
    this.models.forEach((model) => model.dispose());
    this.models.clear();
    this.viewStates.clear();
  }
}

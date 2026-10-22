import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import * as monaco from 'monaco-editor';

import { MonacoModelCache } from './monaco-model.cache';

export interface EditorCursorPosition {
  line: number;
  column: number;
}

interface MonacoWorkerGlobal {
  MonacoEnvironment?: {
    getWorker(moduleId: string, label: string): Worker;
  };
}

let editorLanguageFeaturesConfigured = false;
let monacoStylesPromise: Promise<void> | null = null;
/** Set once the stylesheet has loaded; later editors are created without waiting a tick. */
let monacoStylesLoaded = false;

function ensureMonacoStyles(): Promise<void> {
  if (monacoStylesPromise) return monacoStylesPromise;
  const existing = document.querySelector<HTMLLinkElement>('link[data-monaco-styles]');
  if (existing?.sheet) {
    monacoStylesLoaded = true;
    return Promise.resolve();
  }

  monacoStylesPromise = new Promise<void>((resolve, reject) => {
    const link = existing ?? document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('assets/monaco/editor.main.css', document.baseURI).href;
    link.dataset['monacoStyles'] = '';
    link.addEventListener(
      'load',
      () => {
        monacoStylesLoaded = true;
        resolve();
      },
      { once: true },
    );
    link.addEventListener('error', () => reject(new Error('Could not load Monaco styles')), {
      once: true,
    });
    if (!existing) document.head.append(link);
  });
  return monacoStylesPromise;
}

@Component({
  selector: 'app-monaco-code-editor',
  template: `
    <div #editorHost class="monaco-host"></div>
    @if (!ready()) {
      <div class="editor-loading" role="status">
        <span aria-hidden="true"></span>
        <p>{{ loadError() || 'Loading editor…' }}</p>
      </div>
    }
  `,
  styleUrl: './monaco-code-editor.css',
  host: {
    '[class.editor-ready]': 'ready()',
    '[class.editor-warm]': 'warmStart',
  },
})
export class MonacoCodeEditor implements AfterViewInit, OnDestroy {
  readonly filePath = input.required<string>();
  readonly value = input.required<string>();
  readonly language = input.required<string>();
  readonly ariaLabel = input('Source code editor');
  /** Blocks typing while something else is writing the file, e.g. an AI plan being applied. */
  readonly readOnly = input(false);

  readonly valueChange = output<string>();
  readonly cursorChange = output<EditorCursorPosition>();
  readonly saveRequested = output<void>();
  /** The editor finished starting, or failed to; either way its loading state is over. */
  readonly settled = output<void>();

  private readonly editorHost = viewChild.required<ElementRef<HTMLElement>>('editorHost');
  // Models and view states outlive this component, so returning to the IDE restores the
  // document, its undo history, and the cursor and scroll position.
  private readonly cache = inject(MonacoModelCache);
  private readonly disposables: monaco.IDisposable[] = [];
  private editor: monaco.editor.IStandaloneCodeEditor | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;
  private activePath = '';
  private syncingModel = false;

  /**
   * The stylesheet is already loaded (the user has opened the IDE before), so the editor is
   * created synchronously and shown without the fade-in that would read as a flicker.
   */
  protected readonly warmStart = monacoStylesLoaded;
  protected readonly ready = signal(false);
  protected readonly loadError = signal('');

  private readonly syncActiveFile = effect(() => {
    const ready = this.ready();
    const path = this.filePath();
    const value = this.value();
    const language = this.language();
    if (!ready) return;

    this.activateFile(path, value, language);
  });

  private readonly syncReadOnly = effect(() => {
    const readOnly = this.readOnly();
    if (this.ready()) this.editor?.updateOptions({ readOnly });
  });

  ngAfterViewInit(): void {
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      if (!this.warmStart) await ensureMonacoStyles();
      if (this.destroyed) return;
      this.configureWorker();
      this.configureLanguageFeatures();
      this.createEditor();
      this.ready.set(true);
    } catch (error: unknown) {
      this.loadError.set(error instanceof Error ? error.message : 'Editor could not be loaded');
    }
    if (!this.destroyed) this.settled.emit();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.disposables.forEach((disposable) => disposable.dispose());
    if (this.editor && this.activePath) {
      this.cache.storeViewState(this.activePath, this.editor.saveViewState());
    }
    // Detach first: disposing an editor that still holds a model would dispose the model too.
    this.editor?.setModel(null);
    this.editor?.dispose();
  }

  private createEditor(): void {
    monaco.editor.defineTheme('iot-hub-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '008000', fontStyle: 'italic' },
        { token: 'keyword', foreground: '0000FF' },
        { token: 'type', foreground: '267F99' },
        { token: 'string', foreground: 'A31515' },
        { token: 'number', foreground: '098658' },
      ],
      colors: {
        'editor.background': '#FFFFFF',
        'editor.foreground': '#263142',
        'editor.lineHighlightBackground': '#F7F8FF',
        'editor.lineHighlightBorder': '#00000000',
        'editorLineNumber.foreground': '#A0AABA',
        'editorLineNumber.activeForeground': '#4F46E5',
        'editorCursor.foreground': '#4F46E5',
        'editor.selectionBackground': '#635BFF33',
        'editor.inactiveSelectionBackground': '#635BFF1F',
        'editorIndentGuide.background1': '#E8ECF2',
        'editorIndentGuide.activeBackground1': '#C5BFEE',
        'editorBracketMatch.background': '#635BFF1A',
        'editorBracketMatch.border': '#635BFF66',
        'minimap.background': '#FBFCFE',
        'scrollbarSlider.background': '#B9C1CD55',
        'scrollbarSlider.hoverBackground': '#8B96A688',
      },
    });

    this.editor = monaco.editor.create(this.editorHost().nativeElement, {
      model: null,
      readOnly: this.readOnly(),
      theme: 'iot-hub-light',
      ariaLabel: this.ariaLabel(),
      automaticLayout: false,
      fontFamily: "'Cascadia Code', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      fontLigatures: false,
      fontSize: 12,
      lineHeight: 20,
      padding: { top: 14, bottom: 28 },
      lineNumbersMinChars: 3,
      glyphMargin: false,
      folding: true,
      foldingHighlight: true,
      showFoldingControls: 'mouseover',
      minimap: {
        enabled: true,
        renderCharacters: false,
        showSlider: 'mouseover',
        size: 'proportional',
        maxColumn: 80,
      },
      bracketPairColorization: { enabled: true },
      guides: {
        bracketPairs: true,
        indentation: true,
        highlightActiveIndentation: true,
      },
      quickSuggestions: { other: true, comments: false, strings: false },
      suggest: { preview: true, showSnippets: true },
      wordBasedSuggestions: 'currentDocument',
      snippetSuggestions: 'top',
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      cursorBlinking: 'smooth',
      renderLineHighlight: 'all',
      renderWhitespace: 'selection',
      scrollBeyondLastLine: false,
      stickyScroll: { enabled: false },
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: true,
      fixedOverflowWidgets: true,
      contextmenu: true,
    });

    // Automatic layout clears the minimap canvas, then renders on a later frame.
    // Resize and render together before paint so dragging the splitter cannot flash it blank.
    this.resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;
      this.editor?.layout({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    this.resizeObserver.observe(this.editorHost().nativeElement);

    this.disposables.push(
      this.editor.onDidChangeModelContent(() => {
        if (this.syncingModel || !this.editor?.getModel()) return;
        this.valueChange.emit(this.editor.getValue());
      }),
      this.editor.onDidChangeCursorPosition(({ position }) => {
        this.cursorChange.emit({ line: position.lineNumber, column: position.column });
      }),
      this.editor.addAction({
        id: 'iot-hub.save-file',
        label: 'Save file',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => {
          this.saveRequested.emit();
        },
      }),
    );
  }

  private activateFile(path: string, value: string, language: string): void {
    if (!this.editor) return;

    if (this.activePath && this.activePath !== path) {
      this.cache.storeViewState(this.activePath, this.editor.saveViewState());
    }

    let model = this.cache.model(path);
    if (!model) {
      const uri = monaco.Uri.from({ scheme: 'file', path: `/iot-hub/${path}` });
      // A model can survive in Monaco's registry after its cache entry was dropped.
      monaco.editor.getModel(uri)?.dispose();
      model = monaco.editor.createModel(value, language, uri);
      this.cache.storeModel(path, model);
    } else {
      if (model.getLanguageId() !== language) monaco.editor.setModelLanguage(model, language);
      if (model.getValue() !== value) {
        // pushEditOperations keeps the change undoable, unlike setValue.
        this.syncingModel = true;
        model.pushEditOperations(
          [],
          [{ range: model.getFullModelRange(), text: value }],
          () => null,
        );
        this.syncingModel = false;
      }
    }

    if (this.editor.getModel() !== model) {
      this.editor.setModel(model);
      const viewState = this.cache.viewState(path);
      if (viewState) this.editor.restoreViewState(viewState);
    }

    this.activePath = path;
    const position = this.editor.getPosition();
    if (position) this.cursorChange.emit({ line: position.lineNumber, column: position.column });
  }

  private configureWorker(): void {
    const workerGlobal = globalThis as unknown as MonacoWorkerGlobal;
    if (workerGlobal.MonacoEnvironment) return;

    workerGlobal.MonacoEnvironment = {
      getWorker: () =>
        new Worker(new URL('./monaco-editor.worker', import.meta.url), {
          name: 'monaco-editor-worker',
          type: 'module',
        }),
    };
  }

  private configureLanguageFeatures(): void {
    if (editorLanguageFeaturesConfigured) return;
    editorLanguageFeaturesConfigured = true;

    monaco.languages.registerCompletionItemProvider('cpp', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        );
        const snippet = monaco.languages.CompletionItemKind.Snippet;
        const fn = monaco.languages.CompletionItemKind.Function;
        return {
          suggestions: [
            {
              label: 'setup',
              kind: snippet,
              detail: 'Arduino setup function',
              insertText: 'void setup() {\n  ${1}\n}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: 'loop',
              kind: snippet,
              detail: 'Arduino loop function',
              insertText: 'void loop() {\n  ${1}\n}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: 'Serial.begin',
              kind: fn,
              detail: 'Start the serial monitor',
              insertText: 'Serial.begin(${1:115200});',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: 'pinMode',
              kind: fn,
              detail: 'Configure a GPIO pin',
              insertText: 'pinMode(${1:pin}, ${2:OUTPUT});',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: 'digitalWrite',
              kind: fn,
              detail: 'Write a digital GPIO value',
              insertText: 'digitalWrite(${1:pin}, ${2:HIGH});',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
          ],
        };
      },
    });
  }
}

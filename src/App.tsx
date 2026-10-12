import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Session } from "@supabase/supabase-js";
import {
  Bold,
  Archive,
  ArchiveRestore,
  Bell,
  Braces,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Ellipsis,
  FolderPlus,
  GripVertical,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Maximize2,
  MessageCircle,
  MessageCirclePlus,
  Plus,
  Quote,
  Redo2,
  Search,
  ShieldCheck,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  contentToPlainText,
  editorExtensions,
  inputToContent,
  welcomeMarkdown,
} from "./lib/editor";
import {
  applySlashCommand,
  filterSlashCommands,
  getSlashCommandMatch,
  type SlashCommandId,
  type SlashCommandMatch,
} from "./lib/slashCommands";
import { isAvailableDocument, nextTopSortOrder } from "./lib/documents";
import {
  clearDocumentDraft,
  createBackup,
  createComment,
  createDocument,
  createProject,
  getDocumentDrafts,
  loadWorkspace,
  markNotificationsRead,
  needsDailyBackup,
  replyToComment,
  restoreBackup,
  renameProject,
  saveCloudBackup,
  saveDocumentDraft,
  saveDisplayName,
  setCommentStatus,
  updateDocument,
  updateDocumentLayout,
  updateProject,
  updateProjectLayout,
  updateNotification,
} from "./lib/repository";
import {
  getSession,
  isSupabaseConfigured,
  sendMagicLink,
  signOut,
  supabase,
} from "./lib/supabase";
import { registerWebMcpTools, type WebMcpApi } from "./lib/webmcp";
import type {
  CommentNotification,
  CommentReply,
  CommentStatus,
  CommentThread,
  NoteDocument,
  NoteProject,
  WorkspaceBackup,
  WorkspaceData,
} from "./types";

type DocumentUpdates = Partial<Pick<NoteDocument, "title" | "content_json" | "plain_text" | "deleted_at" | "archived_at" | "project_id" | "sort_order">>;
type SaveState = "saved" | "pending" | "saving" | "error";
type Selection = { from: number; to: number; quote: string } | null;
type ProjectDropTarget = { projectId: string; position: "before" | "after" } | null;
type SlashMenuState = SlashCommandMatch & { top: number; left: number; selectedIndex: number };

const defaultRailWidth = 223;
const railWidthStorageKey = "noted-sidebar-width";
const wideContentStorageKey = "noted-wide-content";

function lastViewedDocumentKey(ownerId: string | null | undefined): string {
  return `noted-last-viewed-document-${ownerId ?? "local"}`;
}

const blankContent: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

function mergeContent(first: JSONContent, second: JSONContent): JSONContent {
  return {
    type: "doc",
    content: [...(first.content ?? []), ...(second.content ?? [])],
  };
}

function findCommentRange(editor: Editor, comment: CommentThread): { from: number; to: number } | null {
  let seen = 0;
  let result: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, position) => {
    if (result || !node.isText || !node.text) return;
    let offset = node.text.indexOf(comment.exact_quote);
    while (offset >= 0) {
      seen += 1;
      if (seen === comment.occurrence) {
        result = { from: position + offset, to: position + offset + comment.exact_quote.length };
        return;
      }
      offset = node.text.indexOf(comment.exact_quote, offset + comment.exact_quote.length);
    }
  });
  return result;
}

function IconButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "is-active" : ""}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function AuthGate({ onAuthenticated }: { onAuthenticated: (session: Session) => void }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) onAuthenticated(session);
    });
    return () => data.subscription.unsubscribe();
  }, [onAuthenticated]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await sendMagicLink(email);
      setMessage("Check your email for a secure sign-in link.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send the sign-in link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand-mark">N</div>
        <p className="eyebrow"><ShieldCheck size={14} /> Private workspace</p>
        <h1>Welcome to Noted</h1>
        <p>Sign in with your existing account to access your private workspace.</p>
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
        />
        <button className="primary-button" disabled={busy} type="submit">
          {busy ? "Sending…" : "Email me a sign-in link"}
        </button>
        {message && <p className="auth-message">{message}</p>}
      </form>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(isSupabaseConfigured ? undefined : null);
  const [documents, setDocuments] = useState<NoteDocument[]>([]);
  const [projects, setProjects] = useState<NoteProject[]>([]);
  const [comments, setComments] = useState<CommentThread[]>([]);
  const [replies, setReplies] = useState<CommentReply[]>([]);
  const [notifications, setNotifications] = useState<CommentNotification[]>([]);
  const [displayName, setDisplayName] = useState("You");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [commentFilter, setCommentFilter] = useState<"open" | "all">("open");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [draggedProject, setDraggedProject] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  const [projectDropTarget, setProjectDropTarget] = useState<ProjectDropTarget>(null);
  const [projectEndDropTarget, setProjectEndDropTarget] = useState(false);
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
  const [toolbarMenuOpen, setToolbarMenuOpen] = useState(false);
  const [wideContent, setWideContent] = useState(() => localStorage.getItem(wideContentStorageKey) === "true");
  const [railWidth, setRailWidth] = useState(() => {
    const stored = Number(localStorage.getItem(railWidthStorageKey));
    return Number.isFinite(stored) && stored >= 180 && stored <= 420 ? stored : defaultRailWidth;
  });

  const userId = session?.user.id ?? null;
  const documentsRef = useRef(documents);
  const projectsRef = useRef(projects);
  const commentsRef = useRef(comments);
  const repliesRef = useRef(replies);
  const notificationsRef = useRef(notifications);
  const activeIdRef = useRef(activeId);
  const displayNameRef = useRef(displayName);
  const userIdRef = useRef(userId);
  const saveTimer = useRef<number | null>(null);
  const refreshing = useRef(false);
  const pendingUpdates = useRef(new Map<string, DocumentUpdates>());
  const saveInFlight = useRef<Promise<void> | null>(null);
  const editorDocumentId = useRef<string | null>(null);
  const commentCardRefs = useRef(new Map<string, HTMLElement>());
  const documentPageRef = useRef<HTMLElement | null>(null);
  const toolbarMenuRef = useRef<HTMLDivElement | null>(null);
  const slashMenuRef = useRef<SlashMenuState | null>(null);
  const slashCommandChangeRef = useRef<(editor: Editor, allowOpen: boolean) => void>(() => undefined);
  const slashCommandKeyDownRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const runSlashCommandRef = useRef<(commandId: SlashCommandId) => void>(() => undefined);

  useEffect(() => { documentsRef.current = documents; }, [documents]);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  useEffect(() => { commentsRef.current = comments; }, [comments]);
  useEffect(() => { repliesRef.current = replies; }, [replies]);
  useEffect(() => { notificationsRef.current = notifications; }, [notifications]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => {
    if (activeId) localStorage.setItem(lastViewedDocumentKey(userId), activeId);
  }, [activeId, userId]);
  useEffect(() => { displayNameRef.current = displayName; }, [displayName]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => {
    if (!mobileRailOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileRailOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileRailOpen]);
  useEffect(() => {
    if (!toolbarMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!toolbarMenuRef.current?.contains(event.target as Node)) setToolbarMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setToolbarMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [toolbarMenuOpen]);

  const editorChangeRef = useRef<(editor: Editor) => void>(() => undefined);
  const selectionChangeRef = useRef<(editor: Editor) => void>(() => undefined);

  const editor = useEditor({
    extensions: editorExtensions,
    content: blankContent,
    autofocus: false,
    editorProps: {
      attributes: {
        class: "document-body",
        "aria-label": "Document body",
      },
      handleClick: (_view, _position, event) => {
        const anchor = event.target instanceof Element
          ? event.target.closest<HTMLElement>(".comment-anchor")
          : null;
        const commentId = anchor?.dataset.commentId;
        if (commentId) return openCommentThread(commentId);
        return false;
      },
      handleKeyDown: (_view, event) => slashCommandKeyDownRef.current(event),
    },
    onUpdate: ({ editor: currentEditor }) => {
      editorChangeRef.current(currentEditor);
      slashCommandChangeRef.current(currentEditor, true);
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      selectionChangeRef.current(currentEditor);
      slashCommandChangeRef.current(currentEditor, false);
    },
  });

  function updateSlashMenu(next: SlashMenuState | null) {
    slashMenuRef.current = next;
    setSlashMenu(next);
  }

  slashCommandChangeRef.current = (currentEditor, allowOpen) => {
    const match = getSlashCommandMatch(currentEditor);
    if (!match || (!allowOpen && !slashMenuRef.current)) {
      if (slashMenuRef.current) updateSlashMenu(null);
      return;
    }

    const page = documentPageRef.current;
    if (!page) return;
    const caret = currentEditor.view.coordsAtPos(currentEditor.state.selection.from);
    const pageRect = page.getBoundingClientRect();
    const menuWidth = Math.min(320, pageRect.width);
    const previous = slashMenuRef.current;
    const filteredCount = filterSlashCommands(match.query).length;
    const next: SlashMenuState = {
      ...match,
      top: caret.bottom - pageRect.top + 7,
      left: Math.max(0, Math.min(caret.left - pageRect.left, pageRect.width - menuWidth)),
      selectedIndex: previous?.query === match.query
        ? Math.min(previous.selectedIndex, Math.max(filteredCount - 1, 0))
        : 0,
    };
    updateSlashMenu(next);
  };

  runSlashCommandRef.current = (commandId) => {
    const current = slashMenuRef.current;
    if (!editor || !current) return;
    updateSlashMenu(null);
    applySlashCommand(editor, commandId, current);
  };

  slashCommandKeyDownRef.current = (event) => {
    const current = slashMenuRef.current;
    if (!current) return false;
    const filtered = filterSlashCommands(current.query);

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!filtered.length) return true;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      updateSlashMenu({
        ...current,
        selectedIndex: (current.selectedIndex + direction + filtered.length) % filtered.length,
      });
      return true;
    }
    if ((event.key === "Enter" || event.key === "Tab") && filtered.length) {
      event.preventDefault();
      runSlashCommandRef.current(filtered[current.selectedIndex]?.id ?? filtered[0].id);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      updateSlashMenu(null);
      return true;
    }
    return false;
  };

  const activeDocument = useMemo(
    () => documents.find((document) => document.id === activeId && isAvailableDocument(document, projects)) ?? null,
    [documents, activeId, projects],
  );

  const workspaceData = useCallback((): WorkspaceData => ({
    projects: projectsRef.current,
    documents: documentsRef.current,
    comments: commentsRef.current,
    replies: repliesRef.current,
    notifications: notificationsRef.current,
    displayName: displayNameRef.current,
  }), []);

  const applyLocalDocumentUpdate = useCallback((documentId: string, updates: DocumentUpdates) => {
    const current = documentsRef.current;
    const existing = current.find((document) => document.id === documentId);
    if (!existing) return;
    const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
    const next = current.map((document) => document.id === documentId ? updated : document);
    documentsRef.current = next;
    saveDocumentDraft(updated);
    setDocuments(next);
  }, []);

  const refreshWorkspace = useCallback(async (quiet = false) => {
    if (isSupabaseConfigured && !userIdRef.current) return;
    if (refreshing.current) return;
    refreshing.current = true;
    if (!quiet) setLoading(true);
    setError("");
    try {
      let data = await loadWorkspace(userIdRef.current);
      if (data.documents.length === 0) {
        const content = inputToContent(welcomeMarkdown, "markdown");
        const welcome = await createDocument(
          userIdRef.current,
          "Welcome to Noted",
          content,
          contentToPlainText(content),
        );
        data = { ...data, documents: [welcome] };
      }
      setDocuments(data.documents);
      setProjects(data.projects);
      setComments(data.comments);
      setReplies(data.replies);
      setNotifications(data.notifications);
      setDisplayName(data.displayName);
      const availableDocuments = data.documents.filter((item) => isAvailableDocument(item, data.projects));
      const rememberedId = localStorage.getItem(lastViewedDocumentKey(userIdRef.current));
      setActiveId((current) => current && availableDocuments.some((item) => item.id === current)
        ? current
        : availableDocuments.find((item) => item.id === rememberedId)?.id
          ?? availableDocuments[0]?.id
          ?? null);

      if (supabase && await needsDailyBackup(userIdRef.current)) {
        await saveCloudBackup(userIdRef.current, createBackup(data));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load the workspace.");
    } finally {
      refreshing.current = false;
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSession(null);
      return;
    }
    void getSession().then(setSession).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Unable to restore your session.");
      setSession(null);
      setLoading(false);
    });
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, [refreshWorkspace]);

  useEffect(() => {
    if (isSupabaseConfigured && !session) {
      if (session !== undefined) setLoading(false);
      return;
    }
    void refreshWorkspace();
  }, [session, refreshWorkspace]);

  useEffect(() => {
    if (!supabase || !userId) return;
    const client = supabase;
    let refreshTimer: number | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refreshWorkspace(true), 350);
    };
    const channel = client.channel(`margin-workspace-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects", filter: `owner_id=eq.${userId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "documents", filter: `owner_id=eq.${userId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "comments", filter: `owner_id=eq.${userId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "comment_replies", filter: `owner_id=eq.${userId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "comment_notifications", filter: `owner_id=eq.${userId}` }, scheduleRefresh)
      .subscribe();
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      void client.removeChannel(channel);
    };
  }, [userId, refreshWorkspace]);

  useEffect(() => {
    if (!editor || !activeDocument) return;
    const changedDocument = editorDocumentId.current !== activeDocument.id;
    const displayed = JSON.stringify(editor.getJSON());
    const incoming = JSON.stringify(activeDocument.content_json);
    if (changedDocument || displayed !== incoming) {
      const editorArea = editor.view.dom.closest(".editor-area");
      const scrollTop = editorArea?.scrollTop ?? 0;
      const previousSelection = editor.state.selection;
      editor.commands.setContent(activeDocument.content_json, { emitUpdate: false });
      if (!changedDocument) {
        const maxPosition = editor.state.doc.content.size;
        editor.commands.setTextSelection({
          from: Math.min(previousSelection.from, maxPosition),
          to: Math.min(previousSelection.to, maxPosition),
        });
      }
      window.requestAnimationFrame(() => {
        if (editorArea) editorArea.scrollTop = scrollTop;
      });
      editorDocumentId.current = activeDocument.id;
      setSelection(null);
      updateSlashMenu(null);
    }
  }, [editor, activeDocument?.id, activeDocument?.revision, activeDocument?.content_json]);

  useEffect(() => {
    if (!editor || !activeId) return;
    const markType = editor.schema.marks.commentAnchor;
    let transaction = editor.state.tr;
    comments
      .filter((comment) => comment.document_id === activeId && !comment.detached)
      .forEach((comment) => {
        let alreadyAnchored = false;
        editor.state.doc.descendants((node) => {
          if (node.marks.some((mark) => mark.type === markType && mark.attrs.commentId === comment.id)) {
            alreadyAnchored = true;
          }
        });
        if (alreadyAnchored) return;
        const range = findCommentRange(editor, comment);
        if (range) transaction = transaction.addMark(range.from, range.to, markType.create({ commentId: comment.id }));
      });
    if (transaction.docChanged) editor.view.dispatch(transaction.setMeta("addToHistory", false));
  }, [editor, activeId, comments]);

  useEffect(() => {
    if (!focusedCommentId) return;
    const thread = comments.find((comment) => comment.id === focusedCommentId);
    if (!thread || thread.document_id !== activeId) setFocusedCommentId(null);
  }, [activeId, comments, focusedCommentId]);

  useEffect(() => {
    if (!commentsOpen || !focusedCommentId) return;
    const thread = comments.find((comment) => comment.id === focusedCommentId);
    if (!thread || thread.document_id !== activeId) return;
    if (commentFilter === "open" && thread.status !== "open") {
      setCommentFilter("all");
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const card = commentCardRefs.current.get(focusedCommentId);
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeId, commentFilter, comments, commentsOpen, focusedCommentId]);

  const flushPendingSave = useCallback(async () => {
    if (saveInFlight.current) await saveInFlight.current;
    const entries = [...pendingUpdates.current.entries()];
    if (!entries.length) return;
    const save = (async () => {
      entries.forEach(([documentId]) => pendingUpdates.current.delete(documentId));
      setSaveState("saving");
      const results = await Promise.allSettled(entries.map(([documentId, updates]) =>
        updateDocument(userIdRef.current, documentId, updates)));
      const savedDocuments = new Map<string, NoteDocument>();
      const failures: string[] = [];

      results.forEach((result, index) => {
        const [documentId, submitted] = entries[index];
        if (result.status === "fulfilled") {
          savedDocuments.set(documentId, result.value);
          return;
        }
        const newer = pendingUpdates.current.get(documentId);
        pendingUpdates.current.set(documentId, { ...submitted, ...newer });
        failures.push(result.reason instanceof Error ? result.reason.message : "Unable to save this note.");
      });

      setDocuments((current) => {
        const next = current.map((document) => {
          const saved = savedDocuments.get(document.id);
          if (!saved || pendingUpdates.current.has(document.id)) return document;
          clearDocumentDraft(document.id);
          return saved;
        });
        documentsRef.current = next;
        return next;
      });

      if (failures.length) {
        setSaveState("error");
        setError(failures[0]);
      } else if (pendingUpdates.current.size) {
        setSaveState("pending");
      } else {
        setSaveState("saved");
      }

      if (pendingUpdates.current.size) {
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => void flushPendingSave(), 5000);
      }
    })();
    saveInFlight.current = save;
    try {
      await save;
    } finally {
      if (saveInFlight.current === save) saveInFlight.current = null;
    }
  }, []);

  const scheduleSave = useCallback((
    documentId: string,
    updates: DocumentUpdates,
  ) => {
    pendingUpdates.current.set(documentId, {
      ...pendingUpdates.current.get(documentId),
      ...updates,
    });
    setSaveState("pending");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flushPendingSave(), 5000);
  }, [flushPendingSave]);

  useEffect(() => {
    if (loading) return;
    const drafts = getDocumentDrafts(userIdRef.current);
    drafts.forEach((draft) => {
      pendingUpdates.current.set(draft.id, {
        ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
        content_json: draft.content_json,
        plain_text: draft.plain_text,
        deleted_at: draft.deleted_at,
      });
    });
    if (drafts.length) {
      setSaveState("pending");
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flushPendingSave(), 5000);
    }
  }, [loading, userId, flushPendingSave]);

  editorChangeRef.current = (currentEditor) => {
    const documentId = activeIdRef.current;
    if (!documentId) return;
    const contentJson = currentEditor.getJSON();
    const plainText = currentEditor.getText({ blockSeparator: "\n\n" });
    applyLocalDocumentUpdate(documentId, { content_json: contentJson, plain_text: plainText });
    scheduleSave(documentId, { content_json: contentJson, plain_text: plainText });
  };

  selectionChangeRef.current = (currentEditor) => {
    const { from, to } = currentEditor.state.selection;
    const quote = currentEditor.state.doc.textBetween(from, to, " ");
    setSelection(from !== to && quote.trim() ? { from, to, quote: quote.trim() } : null);
  };

  useEffect(() => {
    const flush = () => {
      if (pendingUpdates.current.size) void flushPendingSave();
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [flushPendingSave]);

  async function handleNewDocument(projectId: string | null = null) {
    try {
      const sortOrder = nextTopSortOrder(documentsRef.current, projectId);
      const note = await createDocument(userId, "Untitled note", blankContent, "", projectId, sortOrder);
      const next = [note, ...documentsRef.current];
      documentsRef.current = next;
      setDocuments(next);
      setActiveId(note.id);
      setMobileRailOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create a note.");
    }
  }

  async function handleNewProject() {
    const name = window.prompt("Project name", "Untitled project")?.trim();
    if (!name) return;
    try {
      const sortOrder = projectsRef.current.length
        ? Math.max(...projectsRef.current.map((project) => project.sort_order ?? 0)) + 1
        : 0;
      const project = await createProject(userId, name, sortOrder);
      setProjects((current) => [...current, project]);
      setMobileRailOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create a project.");
    }
  }

  async function handleRenameProject(project: NoteProject) {
    const name = window.prompt("Rename project", project.name)?.trim();
    if (!name || name === project.name) return;
    try {
      const updated = await renameProject(userId, project.id, name);
      setProjects((current) => current.map((item) => item.id === project.id ? updated : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to rename the project.");
    }
  }

  async function handleProjectCollapsed(project: NoteProject) {
    const collapsed = !project.collapsed;
    setProjects((current) => current.map((item) => item.id === project.id ? { ...item, collapsed } : item));
    try {
      const updated = await updateProject(userId, project.id, { collapsed });
      setProjects((current) => current.map((item) => item.id === project.id ? updated : item));
    } catch (caught) {
      setProjects((current) => current.map((item) => item.id === project.id ? project : item));
      setError(caught instanceof Error ? caught.message : "Unable to update the project.");
    }
  }

  async function arrangeProject(projectId: string, targetProjectId: string | null = null, placeAfter = false) {
    const original = projectsRef.current;
    if (projectId === targetProjectId) return;
    const moving = original.find((project) => project.id === projectId);
    if (!moving) return;
    const arranged = original.filter((project) => project.id !== projectId && !project.archived_at)
      .sort((first, second) => (first.sort_order ?? 0) - (second.sort_order ?? 0));
    const targetIndex = targetProjectId
      ? Math.max(0, arranged.findIndex((project) => project.id === targetProjectId))
      : arranged.length;
    const insertAt = targetProjectId && placeAfter ? targetIndex + 1 : targetIndex;
    arranged.splice(insertAt, 0, moving);
    const changed = new Map(arranged.map((project, index) => [project.id, { ...project, sort_order: index }]));
    const next = original.map((project) => changed.get(project.id) ?? project);
    projectsRef.current = next;
    setProjects(next);
    try {
      await updateProjectLayout(userId, [...changed.values()].map(({ id, sort_order }) => ({ id, sort_order })));
    } catch (caught) {
      projectsRef.current = original;
      setProjects(original);
      setError(caught instanceof Error ? caught.message : "Unable to arrange the projects.");
    }
  }

  async function arrangeDocument(documentId: string, projectId: string | null, beforeDocumentId: string | null = null) {
    const original = documentsRef.current;
    const moving = original.find((document) => document.id === documentId);
    if (!moving || beforeDocumentId === documentId) return;

    const withoutMoving = original.filter((document) => document.id !== documentId);
    const targetGroup = withoutMoving
      .filter((document) => document.project_id === projectId)
      .sort((first, second) => (first.sort_order ?? 0) - (second.sort_order ?? 0));
    const insertAt = beforeDocumentId
      ? Math.max(0, targetGroup.findIndex((document) => document.id === beforeDocumentId))
      : targetGroup.length;
    targetGroup.splice(insertAt, 0, { ...moving, project_id: projectId });

    const changed = new Map<string, NoteDocument>();
    targetGroup.forEach((document, index) => changed.set(document.id, { ...document, project_id: projectId, sort_order: index }));
    if (moving.project_id !== projectId) {
      withoutMoving
        .filter((document) => document.project_id === moving.project_id)
        .sort((first, second) => (first.sort_order ?? 0) - (second.sort_order ?? 0))
        .forEach((document, index) => changed.set(document.id, { ...document, sort_order: index }));
    }

    const next = original
      .map((document) => changed.get(document.id) ?? document)
      .sort((first, second) => (first.sort_order ?? 0) - (second.sort_order ?? 0));
    documentsRef.current = next;
    setDocuments(next);
    setSaveState("saving");
    try {
      await updateDocumentLayout(userId, [...changed.values()].map(({ id, project_id, sort_order }) => ({ id, project_id, sort_order })));
      setSaveState(pendingUpdates.current.size ? "pending" : "saved");
    } catch (caught) {
      documentsRef.current = original;
      setDocuments(original);
      setSaveState("error");
      setError(caught instanceof Error ? caught.message : "Unable to arrange the note.");
    }
  }

  function startDocumentDrag(event: React.DragEvent<HTMLElement>, documentId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-notes-document", documentId);
    event.dataTransfer.setData("text/plain", documentId);
  }

  function startProjectDrag(event: React.DragEvent<HTMLElement>, project: NoteProject) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-notes-project", project.id);
    setDraggedProject({ id: project.id, name: project.name, x: event.clientX, y: event.clientY });
    setProjectDropTarget(null);
    setProjectEndDropTarget(false);
  }

  function updateProjectDrag(event: React.DragEvent<HTMLElement>) {
    if (!event.clientX && !event.clientY) return;
    setDraggedProject((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current);
  }

  function endProjectDrag() {
    setDraggedProject(null);
    setProjectDropTarget(null);
    setProjectEndDropTarget(false);
  }

  function setProjectLandingSpot(event: React.DragEvent<HTMLElement>, projectId: string) {
    const movingProjectId = droppedProjectId(event) || draggedProject?.id;
    if (!movingProjectId || movingProjectId === projectId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    setProjectDropTarget((current) => current?.projectId === projectId && current.position === position
      ? current
      : { projectId, position });
    setProjectEndDropTarget(false);
  }

  function startRailResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = railWidth;
    const resize = (moveEvent: PointerEvent) => {
      const maxWidth = Math.min(420, window.innerWidth - 360);
      setRailWidth(Math.max(180, Math.min(maxWidth, startWidth + moveEvent.clientX - startX)));
    };
    const finish = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.classList.remove("is-resizing-sidebar");
      setRailWidth((width) => {
        localStorage.setItem(railWidthStorageKey, String(width));
        return width;
      });
    };
    document.body.classList.add("is-resizing-sidebar");
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  }

  function toggleWideContent() {
    setWideContent((current) => {
      const next = !current;
      localStorage.setItem(wideContentStorageKey, String(next));
      return next;
    });
  }

  function droppedDocumentId(event: React.DragEvent<HTMLElement>) {
    return event.dataTransfer.getData("application/x-notes-document") || event.dataTransfer.getData("text/plain");
  }

  function droppedProjectId(event: React.DragEvent<HTMLElement>) {
    return event.dataTransfer.getData("application/x-notes-project");
  }

  async function handleArchiveDocument(document: NoteDocument) {
    if (!window.confirm(`Archive “${document.title}”? You can restore it from Archived.`)) return;
    try {
      await flushPendingSave();
      if (pendingUpdates.current.has(document.id)) {
        throw new Error("Save this note before archiving it.");
      }
      const archivedAt = new Date().toISOString();
      const latest = documentsRef.current.find((item) => item.id === document.id) ?? document;
      const updated = await updateDocument(userId, document.id, {
        title: latest.title,
        content_json: latest.content_json,
        plain_text: latest.plain_text,
        archived_at: archivedAt,
      });
      pendingUpdates.current.delete(document.id);
      clearDocumentDraft(document.id);
      setDocuments((current) => current.map((item) => item.id === document.id ? updated : item));
      if (activeId === document.id) {
        setActiveId(documents.find((item) => item.id !== document.id && isAvailableDocument(item, projectsRef.current))?.id ?? null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to archive this note.");
    }
  }

  async function handleRestoreDocument(document: NoteDocument) {
    try {
      const updated = await updateDocument(userId, document.id, { archived_at: null });
      setDocuments((current) => current.map((item) => item.id === document.id ? updated : item));
      if (isAvailableDocument(updated, projectsRef.current)) {
        setActiveId(updated.id);
        setMobileRailOpen(false);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to restore this note.");
    }
  }

  async function handleArchiveProject(project: NoteProject) {
    if (!window.confirm(`Archive “${project.name}”? Its notes will stay together and can be restored from Archived.`)) return;
    try {
      const updated = await updateProject(userId, project.id, { archived_at: new Date().toISOString() });
      setProjects((current) => current.map((item) => item.id === project.id ? updated : item));
      if (activeDocument?.project_id === project.id) {
        setActiveId(documents.find((item) => item.project_id !== project.id && isAvailableDocument(item, projectsRef.current))?.id ?? null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to archive this project.");
    }
  }

  async function handleRestoreProject(project: NoteProject) {
    try {
      const updated = await updateProject(userId, project.id, { archived_at: null });
      setProjects((current) => current.map((item) => item.id === project.id ? updated : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to restore this project.");
    }
  }

  function handleTitleChange(title: string) {
    if (!activeDocument) return;
    applyLocalDocumentUpdate(activeDocument.id, { title });
    if (title.trim()) scheduleSave(activeDocument.id, { title: title.trim() });
  }

  async function submitComment() {
    if (!activeDocument || !selection || !commentDraft.trim() || !editor) return;
    setCommenting(true);
    try {
      const plain = activeDocument.plain_text;
      const offset = plain.indexOf(selection.quote);
      const comment = await createComment(userId, {
        document_id: activeDocument.id,
        body: commentDraft.trim(),
        exact_quote: selection.quote,
        occurrence: 1,
        prefix: offset >= 0 ? plain.slice(Math.max(0, offset - 80), offset) : "",
        suffix: offset >= 0 ? plain.slice(offset + selection.quote.length, offset + selection.quote.length + 80) : "",
        author_name: displayName,
      });
      editor.chain().focus().setTextSelection({ from: selection.from, to: selection.to })
        .setMark("commentAnchor", { commentId: comment.id }).run();
      setComments((current) => [...current, comment]);
      setCommentDraft("");
      setSelection(null);
      setCommentsOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to add the comment.");
    } finally {
      setCommenting(false);
    }
  }

  async function handleReply(commentId: string) {
    const body = replyDrafts[commentId]?.trim();
    if (!body) return;
    try {
      const reply = await replyToComment(userId, commentId, body, displayName);
      setReplies((current) => [...current, reply]);
      setReplyDrafts((current) => ({ ...current, [commentId]: "" }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to reply.");
    }
  }

  async function handleCommentStatus(commentId: string, status: CommentStatus) {
    try {
      const updated = await setCommentStatus(userId, commentId, status);
      setComments((current) => current.map((item) => item.id === commentId ? updated : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update the comment.");
    }
  }

  async function handleDisplayName(value: string) {
    const clean = value.trim() || "You";
    setDisplayName(clean);
    try {
      await saveDisplayName(userId, clean);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save your display name.");
    }
  }

  async function handleExport() {
    const backup = createBackup(workspaceData());
    if (supabase) await saveCloudBackup(userId, backup);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `noted-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(file: File) {
    try {
      const backup = JSON.parse(await file.text()) as WorkspaceBackup;
      await restoreBackup(userId, backup);
      await refreshWorkspace();
      setSettingsOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to import this backup.");
    }
  }

  async function openNotification(notification: CommentNotification) {
    const thread = commentsRef.current.find((comment) => comment.id === notification.comment_id);
    if (!thread) return;
    openCommentThread(thread.id);
    if (notification.read_at) return;
    try {
      const [updated] = await markNotificationsRead(userIdRef.current, [notification.id]);
      if (updated) {
        setNotifications((current) => current.map((item) => item.id === updated.id ? updated : item));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to mark the notification as read.");
    }
  }

  function openCommentThread(commentId: string): boolean {
    const thread = commentsRef.current.find((comment) => comment.id === commentId);
    if (!thread) return false;
    setActiveId(thread.document_id);
    setCommentsOpen(true);
    setCommenting(false);
    setNotificationsOpen(false);
    if (thread.status !== "open") setCommentFilter("all");
    setFocusedCommentId(commentId);
    return true;
  }

  async function markAllToddNotificationsRead() {
    const ids = notificationsRef.current
      .filter((notification) => notification.recipient_handle === "todd" && !notification.read_at)
      .map((notification) => notification.id);
    if (!ids.length) return;
    try {
      const updated = await markNotificationsRead(userIdRef.current, ids);
      const updatedById = new Map(updated.map((notification) => [notification.id, notification]));
      setNotifications((current) => current.map((item) => updatedById.get(item.id) ?? item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to mark notifications as read.");
    }
  }

  const webMcpApiRef = useRef<WebMcpApi | null>(null);
  webMcpApiRef.current = {
    listProjects: async (search, includeArchived = false) => {
      const normalized = search?.toLowerCase();
      return projectsRef.current
        .filter((project) => includeArchived || !project.archived_at)
        .filter((project) => !normalized || project.name.toLowerCase().includes(normalized))
        .sort((first, second) => (first.sort_order ?? 0) - (second.sort_order ?? 0))
        .map((project) => ({
          id: project.id,
          name: project.name,
          sort_order: project.sort_order,
          archived_at: project.archived_at,
          note_count: documentsRef.current.filter((document) =>
            document.project_id === project.id && !document.archived_at && !document.deleted_at).length,
        }));
    },
    createProject: async (name) => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("Project name is required.");
      const sortOrder = projectsRef.current.length
        ? Math.max(...projectsRef.current.map((project) => project.sort_order ?? 0)) + 1
        : 0;
      const project = await createProject(userIdRef.current, trimmedName, sortOrder);
      const next = [...projectsRef.current, project];
      projectsRef.current = next;
      setProjects(next);
      return project;
    },
    listDocuments: async (search, limit = 50) => {
      const normalized = search?.toLowerCase();
      const projectById = new Map(projectsRef.current.map((project) => [project.id, project]));
      return documentsRef.current
        .filter((item) => isAvailableDocument(item, projectsRef.current))
        .filter((item) => !normalized || `${item.title}\n${item.plain_text}\n${projectById.get(item.project_id ?? "")?.name ?? ""}`.toLowerCase().includes(normalized))
        .slice(0, Math.min(limit, 100))
        .map((item) => ({
          id: item.id,
          title: item.title,
          updated_at: item.updated_at,
          revision: item.revision,
          snippet: item.plain_text.slice(0, 240),
          project: item.project_id ? (() => {
            const project = projectById.get(item.project_id!);
            return project ? { id: project.id, name: project.name } : { id: item.project_id, name: "Unknown project" };
          })() : null,
        }));
    },
    getDocument: async (documentId) => {
      const note = documentsRef.current.find((item) => item.id === documentId);
      if (!note || !isAvailableDocument(note, projectsRef.current)) throw new Error("Document not found.");
      const project = note.project_id ? projectsRef.current.find((item) => item.id === note.project_id) : null;
      const threads = commentsRef.current.filter((item) => item.document_id === documentId);
      return { ...note, project: project ? { id: project.id, name: project.name } : null, comments: threads.map((thread) => ({
        ...thread,
        replies: repliesRef.current.filter((reply) => reply.comment_id === thread.id),
      })) };
    },
    openDocument: async (documentId) => {
      const note = documentsRef.current.find((item) => item.id === documentId);
      if (!note || !isAvailableDocument(note, projectsRef.current)) throw new Error("Document not found.");
      setActiveId(documentId);
      return { opened: true, document_id: documentId, title: note.title };
    },
    createDocument: async (title, content, format) => {
      const contentJson = inputToContent(content, format);
      const sortOrder = nextTopSortOrder(documentsRef.current, null);
      const note = await createDocument(userIdRef.current, title, contentJson, contentToPlainText(contentJson), null, sortOrder);
      const next = [note, ...documentsRef.current];
      documentsRef.current = next;
      setDocuments(next);
      setActiveId(note.id);
      return note;
    },
    updateDocument: async ({ documentId, title, content, format, mode }) => {
      const existing = documentsRef.current.find((item) => item.id === documentId);
      if (!existing || !isAvailableDocument(existing, projectsRef.current)) throw new Error("Document not found.");
      let contentJson = existing.content_json;
      if (content !== undefined) {
        const incoming = inputToContent(content, format);
        contentJson = mode === "append" ? mergeContent(existing.content_json, incoming) : incoming;
      }
      const updates = {
        ...(title ? { title } : {}),
        ...(content !== undefined ? { content_json: contentJson, plain_text: contentToPlainText(contentJson) } : {}),
      };
      const saved = await updateDocument(userIdRef.current, documentId, updates);
      setDocuments((current) => current.map((item) => item.id === documentId ? saved : item));
      if (activeIdRef.current === documentId && editor) {
        editor.commands.setContent(saved.content_json, { emitUpdate: false });
      }
      return saved;
    },
    listComments: async (documentId, status = "open") => commentsRef.current
      .filter((item) => (!documentId || item.document_id === documentId) && (status === "all" || item.status === status))
      .map((thread) => ({ ...thread, replies: repliesRef.current.filter((reply) => reply.comment_id === thread.id) })),
    addComment: async (input) => {
      const documentId = String(input.document_id ?? "");
      const body = String(input.body ?? "");
      const exactQuote = String(input.exact_quote ?? "");
      const note = documentsRef.current.find((item) => item.id === documentId);
      if (!note) throw new Error("Document not found.");
      const matches = note.plain_text.split(exactQuote).length - 1;
      if (matches === 0) throw new Error("The exact quote is not present in this document.");
      const occurrence = Number(input.occurrence ?? 1);
      if (!input.occurrence && matches > 1 && !input.prefix && !input.suffix) {
        throw new Error("The quote appears more than once. Provide occurrence, prefix, or suffix.");
      }
      const comment = await createComment(userIdRef.current, {
        document_id: documentId,
        body,
        exact_quote: exactQuote,
        occurrence,
        prefix: typeof input.prefix === "string" ? input.prefix : "",
        suffix: typeof input.suffix === "string" ? input.suffix : "",
        author_name: typeof input.agent_name === "string" ? input.agent_name : "Codex",
      });
      setComments((current) => [...current, comment]);
      if (activeIdRef.current === documentId) setCommentsOpen(true);
      return comment;
    },
    replyToComment: async (commentId, body, agentName = "Codex") => {
      const reply = await replyToComment(userIdRef.current, commentId, body, agentName);
      setReplies((current) => [...current, reply]);
      return reply;
    },
    setCommentStatus: async (commentId, status) => {
      const updated = await setCommentStatus(userIdRef.current, commentId, status);
      setComments((current) => current.map((item) => item.id === commentId ? updated : item));
      return updated;
    },
    listNotifications: async (recipient = "gpt", state = "pending") => notificationsRef.current
      .filter((notification) => notification.recipient_handle === recipient.toLowerCase())
      .filter((notification) => state === "all"
        || (state === "unread" && !notification.read_at)
        || (state === "pending" && !notification.acknowledged_at && !notification.completed_at)
        || (state === "planned" && Boolean(notification.acknowledged_at) && !notification.completed_at)
        || (state === "completed" && Boolean(notification.completed_at)))
      .map((notification) => {
        const thread = commentsRef.current.find((comment) => comment.id === notification.comment_id);
        const sourceReply = notification.source_reply_id
          ? repliesRef.current.find((reply) => reply.id === notification.source_reply_id)
          : null;
        const document = thread
          ? documentsRef.current.find((item) => item.id === thread.document_id)
          : null;
        const project = document?.project_id
          ? projectsRef.current.find((item) => item.id === document.project_id)
          : null;
        return {
          ...notification,
          source: sourceReply ?? thread ?? null,
          document: document ? {
            id: document.id,
            title: document.title,
            project: project ? { id: project.id, name: project.name } : null,
          } : null,
          thread,
          replies: repliesRef.current.filter((reply) => reply.comment_id === notification.comment_id),
        };
      }),
    acknowledgeNotification: async (notificationId, planId) => {
      const timestamp = new Date().toISOString();
      const updated = await updateNotification(userIdRef.current, notificationId, {
        read_at: timestamp,
        acknowledged_at: timestamp,
        plan_id: planId,
      });
      setNotifications((current) => current.map((item) => item.id === updated.id ? updated : item));
      return updated;
    },
    completeNotification: async (notificationId) => {
      const timestamp = new Date().toISOString();
      const updated = await updateNotification(userIdRef.current, notificationId, {
        read_at: timestamp,
        completed_at: timestamp,
      });
      setNotifications((current) => current.map((item) => item.id === updated.id ? updated : item));
      return updated;
    },
  };

  useEffect(() => {
    if (!webMcpApiRef.current) return;
    void registerWebMcpTools({
      listProjects: (...args) => webMcpApiRef.current!.listProjects(...args),
      createProject: (...args) => webMcpApiRef.current!.createProject(...args),
      listDocuments: (...args) => webMcpApiRef.current!.listDocuments(...args),
      getDocument: (...args) => webMcpApiRef.current!.getDocument(...args),
      openDocument: (...args) => webMcpApiRef.current!.openDocument(...args),
      createDocument: (...args) => webMcpApiRef.current!.createDocument(...args),
      updateDocument: (...args) => webMcpApiRef.current!.updateDocument(...args),
      listComments: (...args) => webMcpApiRef.current!.listComments(...args),
      addComment: (...args) => webMcpApiRef.current!.addComment(...args),
      replyToComment: (...args) => webMcpApiRef.current!.replyToComment(...args),
      setCommentStatus: (...args) => webMcpApiRef.current!.setCommentStatus(...args),
      listNotifications: (...args) => webMcpApiRef.current!.listNotifications(...args),
      acknowledgeNotification: (...args) => webMcpApiRef.current!.acknowledgeNotification(...args),
      completeNotification: (...args) => webMcpApiRef.current!.completeNotification(...args),
    });
  }, []);

  const activeProjects = projects
    .filter((project) => !project.archived_at)
    .sort((first, second) => (first.sort_order ?? 0) - (second.sort_order ?? 0));
  const archivedProjects = projects.filter((project) => Boolean(project.archived_at));
  const activeDocuments = documents.filter((document) => isAvailableDocument(document, projects));
  const archivedDocuments = documents.filter((document) => Boolean(document.archived_at));
  const visibleDocuments = activeDocuments.filter((document) => {
    const normalized = query.trim().toLowerCase();
    return !normalized || `${document.title}\n${document.plain_text}`.toLowerCase().includes(normalized);
  });
  const ungroupedDocuments = visibleDocuments.filter((document) => !document.project_id);
  const activeComments = comments.filter((comment) =>
    comment.document_id === activeId && (commentFilter === "all" || comment.status === "open"));
  const totalThreads = comments.filter((comment) => comment.document_id === activeId).length;
  const openThreads = comments.filter((comment) => comment.document_id === activeId && comment.status === "open").length;
  const toddNotifications = notifications.filter((notification) => notification.recipient_handle === "todd");
  const unreadNotifications = toddNotifications.filter((notification) => !notification.read_at).length;

  if (isSupabaseConfigured && session === undefined) {
    return <main className="loading-page">Opening your workspace…</main>;
  }
  if (isSupabaseConfigured && !session) {
    return <AuthGate onAuthenticated={setSession} />;
  }

  function selectDocument(documentId: string) {
    setActiveId(documentId);
    setMobileRailOpen(false);
  }

  return (
    <div className={`app-shell ${commentsOpen ? "comments-visible" : ""} ${mobileRailOpen ? "mobile-rail-open" : ""}`} style={{ "--rail": `${railWidth}px` } as React.CSSProperties}>
      {draggedProject && (
        <div className="project-drag-preview" style={{ left: draggedProject.x + 12, top: draggedProject.y + 12 }} aria-hidden="true">
          <GripVertical size={13} /> {draggedProject.name}
        </div>
      )}
      <button type="button" className="mobile-rail-backdrop" aria-label="Close sidebar" onClick={() => setMobileRailOpen(false)} />
      <aside className="document-rail" aria-label="Documents" id="document-rail">
        <div className="rail-actions">
          <span className="rail-brand">Noted</span>
          <div className="rail-tools">
            <IconButton label="Search documents" active={searching} onClick={() => setSearching((value) => !value)}>
              <Search size={18} />
            </IconButton>
            <button type="button" className="new-note" aria-label="New note" title="New note" onClick={() => void handleNewDocument()}>
              <Plus size={18} />
            </button>
            <button type="button" className="mobile-rail-close" aria-label="Close sidebar" onClick={() => setMobileRailOpen(false)}>
              <X size={18} />
            </button>
          </div>
        </div>
        {searching && (
          <div className="search-box">
            <Search size={15} />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" />
            {query && <button aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button>}
          </div>
        )}
        <div className="document-list">
          <div className="rail-section-heading">
            <p className="rail-label">Projects</p>
            <button type="button" aria-label="Create project" title="Create project" onClick={() => void handleNewProject()}>
              <FolderPlus size={14} />
            </button>
          </div>
          {activeProjects.map((project) => {
            const projectDocuments = visibleDocuments.filter((document) => document.project_id === project.id);
            return (
              <section
                className={`project-group ${draggedProject?.id === project.id ? "is-dragging" : ""} ${projectDropTarget?.projectId === project.id ? `is-drop-${projectDropTarget.position}` : ""}`}
                key={project.id}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
                onDrop={(event) => {
                  event.preventDefault();
                  const projectId = droppedProjectId(event);
                  if (projectId) void arrangeProject(projectId);
                  else void arrangeDocument(droppedDocumentId(event), project.id);
                  endProjectDrag();
                }}
              >
                <div
                  className="project-heading"
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    event.dataTransfer.dropEffect = "move";
                    setProjectLandingSpot(event, project.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const projectId = droppedProjectId(event);
                    if (projectId) {
                      const position = projectDropTarget?.projectId === project.id
                        ? projectDropTarget.position
                        : "before";
                      void arrangeProject(projectId, project.id, position === "after");
                    }
                    else void arrangeDocument(droppedDocumentId(event), project.id);
                    endProjectDrag();
                  }}
                >
                  <span
                    className="project-drag-handle"
                    title="Drag project"
                    draggable
                    onDragStart={(event) => startProjectDrag(event, project)}
                    onDrag={(event) => updateProjectDrag(event)}
                    onDragEnd={endProjectDrag}
                  ><GripVertical size={13} /></span>
                  <button
                    type="button"
                    className="project-collapse"
                    aria-label={`${project.collapsed ? "Expand" : "Collapse"} ${project.name}`}
                    aria-expanded={!project.collapsed}
                    title={project.collapsed ? "Expand project" : "Collapse project"}
                    onClick={() => void handleProjectCollapsed(project)}
                  >
                    {project.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <button type="button" className="project-title" title="Rename project" onClick={() => void handleRenameProject(project)}>
                    {project.name}
                  </button>
                  <button type="button" className="project-new-note" aria-label={`New note in ${project.name}`} onClick={() => void handleNewDocument(project.id)}>
                    <Plus size={13} />
                  </button>
                  <button type="button" className="project-archive" aria-label={`Archive ${project.name}`} title="Archive project" onClick={() => void handleArchiveProject(project)}>
                    <Archive size={13} />
                  </button>
                </div>
                {!project.collapsed && projectDocuments.map((document) => (
                  <div
                    className={`document-row project-document ${document.id === activeId ? "is-selected" : ""}`}
                    draggable
                    onDragStart={(event) => startDocumentDrag(event, document.id)}
                    onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; }}
                    onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void arrangeDocument(droppedDocumentId(event), project.id, document.id); }}
                    key={document.id}
                  >
                    <span className="drag-handle" title="Drag note">
                      <GripVertical size={13} />
                    </span>
                    <button type="button" onClick={() => selectDocument(document.id)}>{document.title}</button>
                    <button type="button" className="archive-note" aria-label={`Archive ${document.title}`} title="Archive note" onClick={() => void handleArchiveDocument(document)}>
                      <Archive size={14} />
                    </button>
                  </div>
                ))}
              </section>
            );
          })}
          <div
            className={`project-end-drop-zone ${projectEndDropTarget ? "is-active" : ""}`}
            aria-hidden={!draggedProject}
            onDragOver={(event) => {
              const projectId = droppedProjectId(event) || draggedProject?.id;
              if (!projectId) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setProjectDropTarget(null);
              setProjectEndDropTarget(true);
            }}
            onDrop={(event) => {
              const projectId = droppedProjectId(event);
              if (!projectId) return;
              event.preventDefault();
              void arrangeProject(projectId);
              endProjectDrag();
            }}
          >
            <span>Move to bottom</span>
          </div>

          <p
            className="rail-label drop-target"
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
            onDrop={(event) => { event.preventDefault(); void arrangeDocument(droppedDocumentId(event), null); }}
          >Notes</p>
          {ungroupedDocuments.map((document) => (
            <div
              className={`document-row ${document.id === activeId ? "is-selected" : ""}`}
              draggable
              onDragStart={(event) => startDocumentDrag(event, document.id)}
              onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; }}
              onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void arrangeDocument(droppedDocumentId(event), null, document.id); }}
              key={document.id}
            >
              <span className="drag-handle" title="Drag note">
                <GripVertical size={13} />
              </span>
              <button type="button" onClick={() => selectDocument(document.id)}>{document.title}</button>
              <button type="button" className="archive-note" aria-label={`Archive ${document.title}`} title="Archive note" onClick={() => void handleArchiveDocument(document)}>
                <Archive size={14} />
              </button>
            </div>
          ))}
          {!ungroupedDocuments.length && <p className="empty-list">No ungrouped notes.</p>}
          {(archivedProjects.length > 0 || archivedDocuments.length > 0) && (
            <details className="archive-list">
              <summary>Archived ({archivedProjects.length + archivedDocuments.length})</summary>
              {archivedProjects.map((project) => (
                <div className="archive-row" key={project.id}>
                  <span>{project.name}</span>
                  <button type="button" title="Restore project" aria-label={`Restore ${project.name}`} onClick={() => void handleRestoreProject(project)}>
                    <ArchiveRestore size={14} />
                  </button>
                </div>
              ))}
              {archivedDocuments.map((document) => (
                <div className="archive-row" key={document.id}>
                  <span>{document.title}</span>
                  <button type="button" title="Restore note" aria-label={`Restore ${document.title}`} onClick={() => void handleRestoreDocument(document)}>
                    <ArchiveRestore size={14} />
                  </button>
                </div>
              ))}
            </details>
          )}
        </div>
        <div
          className="rail-resizer"
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          onPointerDown={startRailResize}
        />
        <div className="rail-footer">
          <span className={`connection-dot ${isSupabaseConfigured ? "cloud" : "local"}`} />
          <Braces size={14} />
          <span>WebMCP</span>
          <ChevronLeft size={16} className="rail-chevron" />
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <span className="document-breadcrumb desktop-breadcrumb">{activeDocument?.title ?? "Noted"}</span>
          <button
            type="button"
            className="document-breadcrumb mobile-rail-toggle"
            aria-label="Open sidebar"
            aria-controls="document-rail"
            aria-expanded={mobileRailOpen}
            onClick={() => setMobileRailOpen(true)}
          >
            <span>{activeDocument?.title ?? "Noted"}</span><ChevronDown size={14} />
          </button>
          <div className="header-actions">
            <button type="button" className={`save-indicator ${saveState}`} onClick={() => setSettingsOpen(true)}>
              <span className="connection-dot cloud" />
              {saveState === "pending"
                ? "Saved locally"
                : saveState === "saving"
                  ? "Syncing…"
                  : saveState === "error"
                    ? "Cloud sync paused"
                    : isSupabaseConfigured ? "Saved to Supabase" : "Saved on this device"}
            </button>
            <div className="notification-menu">
              <button
                type="button"
                className={`header-button icon-only notification-button ${notificationsOpen ? "is-active" : ""}`}
                aria-label="Mentions"
                aria-expanded={notificationsOpen}
                title="Mentions"
                onClick={() => setNotificationsOpen((value) => !value)}
              >
                <Bell size={18} />
                {unreadNotifications > 0 && <span className="count-badge">{unreadNotifications}</span>}
              </button>
              {notificationsOpen && (
                <section className="notification-popover" aria-label="Mention notifications">
                  <div className="notification-heading">
                    <div><strong>Mentions</strong><span>@todd</span></div>
                    <button type="button" disabled={!unreadNotifications} onClick={() => void markAllToddNotificationsRead()}>
                      Mark all read
                    </button>
                  </div>
                  <div className="notification-list">
                    {toddNotifications.map((notification) => {
                      const thread = comments.find((comment) => comment.id === notification.comment_id);
                      const sourceReply = notification.source_reply_id
                        ? replies.find((reply) => reply.id === notification.source_reply_id)
                        : null;
                      const document = thread ? documents.find((item) => item.id === thread.document_id) : null;
                      const source = sourceReply ?? thread;
                      return (
                        <button
                          type="button"
                          className={`notification-item ${notification.read_at ? "is-read" : "is-unread"}`}
                          key={notification.id}
                          onClick={() => void openNotification(notification)}
                        >
                          <span className="notification-dot" />
                          <span className="notification-copy">
                            <span><strong>{source?.author_name ?? "Unknown"}</strong> mentioned you in {document?.title ?? "a note"}</span>
                            <span>{source?.body ?? "The source comment is no longer available."}</span>
                            <time>{new Date(notification.created_at).toLocaleString()}</time>
                          </span>
                        </button>
                      );
                    })}
                    {!toddNotifications.length && (
                      <p className="notification-empty">No @todd mentions yet.</p>
                    )}
                  </div>
                </section>
              )}
            </div>
            {selection && (
              <button type="button" className="comment-selection-button" onClick={() => { setFocusedCommentId(null); setCommentsOpen(true); setCommenting(true); }}>
                <MessageCirclePlus size={17} /> Comment
              </button>
            )}
            <button
              type="button"
              className={`header-button icon-only ${commentsOpen ? "is-active" : ""}`}
              aria-label="Comments"
              aria-expanded={commentsOpen}
              title="Comments"
              onClick={() => { setFocusedCommentId(null); setCommentsOpen((value) => !value); }}
            >
              <MessageCircle size={18} />
              {openThreads > 0 && <span className="count-badge">{openThreads}</span>}
            </button>
            <IconButton label="Workspace settings" onClick={() => setSettingsOpen(true)}><Ellipsis size={19} /></IconButton>
          </div>
        </header>

        <section className={`editor-area ${wideContent ? "is-wide" : ""}`} aria-label="Editor">
          <div className="toolbar" role="toolbar" aria-label="Text formatting">
            <div className="toolbar-controls">
            <label className="style-select">
              <select
                aria-label="Text style"
                value={editor?.isActive("heading", { level: 1 }) ? "h1" : editor?.isActive("heading", { level: 2 }) ? "h2" : editor?.isActive("heading", { level: 3 }) ? "h3" : "p"}
                onChange={(event) => {
                  if (!editor) return;
                  const value = event.target.value;
                  if (value === "p") editor.chain().focus().setParagraph().run();
                  else editor.chain().focus().toggleHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run();
                }}
              >
                <option value="p">Text</option>
                <option value="h1">Heading 1</option>
                <option value="h2">Heading 2</option>
                <option value="h3">Heading 3</option>
              </select>
              <ChevronDown size={15} />
            </label>
            <span className="toolbar-divider" />
            <IconButton label="Bold" active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={18} /></IconButton>
            <IconButton label="Italic" active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={18} /></IconButton>
            <IconButton label="Inline code" active={editor?.isActive("code")} onClick={() => editor?.chain().focus().toggleCode().run()}><Braces size={17} /></IconButton>
            <IconButton label="Link" active={editor?.isActive("link")} onClick={() => {
              if (!editor) return;
              const current = editor.getAttributes("link").href as string | undefined;
              const href = window.prompt("Link URL", current ?? "https://");
              if (href === null) return;
              if (!href) editor.chain().focus().unsetLink().run();
              else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
            }}><LinkIcon size={17} /></IconButton>
            <span className="toolbar-divider" />
            <IconButton label="Bulleted list" active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List size={18} /></IconButton>
            <IconButton label="Numbered list" active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered size={18} /></IconButton>
            <IconButton label="Checklist" active={editor?.isActive("taskList")} onClick={() => editor?.chain().focus().toggleTaskList().run()}><CheckSquare size={18} /></IconButton>
            <IconButton label="Quote" active={editor?.isActive("blockquote")} onClick={() => editor?.chain().focus().toggleBlockquote().run()}><Quote size={18} /></IconButton>
            <span className="toolbar-spacer" />
            <IconButton label="Undo" disabled={!editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={17} /></IconButton>
            <IconButton label="Redo" disabled={!editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={17} /></IconButton>
            </div>
            <div
              ref={toolbarMenuRef}
              className="toolbar-more-menu"
            >
              <button
                type="button"
                className={`icon-button ${toolbarMenuOpen ? "is-active" : ""}`}
                aria-label="Page options"
                aria-controls="page-options-popover"
                aria-expanded={toolbarMenuOpen}
                title="Page options"
                onClick={() => setToolbarMenuOpen((value) => !value)}
              >
                <Ellipsis size={19} />
              </button>
              {toolbarMenuOpen && (
                <div id="page-options-popover" className="toolbar-more-popover" role="group" aria-label="Page options">
                  <label
                    className="toolbar-menu-item"
                  >
                    <Maximize2 size={16} />
                    <span>Wide</span>
                    <span className="toggle-switch">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={wideContent}
                        onChange={toggleWideContent}
                      />
                      <span className="toggle-switch-track" aria-hidden="true">
                        <span className="toggle-switch-thumb" />
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </div>
          </div>

          {loading ? (
            <div className="editor-loading">Loading your notes…</div>
          ) : activeDocument ? (
            <article className="document-page" ref={documentPageRef}>
              <input
                className="document-title"
                aria-label="Document title"
                value={activeDocument.title}
                onChange={(event) => handleTitleChange(event.target.value)}
                onBlur={() => void flushPendingSave()}
              />
              <EditorContent editor={editor} onBlur={() => {
                updateSlashMenu(null);
                void flushPendingSave();
              }} />
              {slashMenu && (() => {
                const filtered = filterSlashCommands(slashMenu.query);
                return (
                  <div
                    className="slash-command-menu"
                    role="listbox"
                    aria-label="Insert a block"
                    style={{ top: slashMenu.top, left: slashMenu.left }}
                  >
                    <div className="slash-command-search" aria-hidden="true">
                      <Search size={14} />
                      <span><strong>/</strong>{slashMenu.query || "Type to filter…"}</span>
                    </div>
                    <div className="slash-command-label">Insert block</div>
                    {filtered.map((option, index) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === slashMenu.selectedIndex}
                        className={index === slashMenu.selectedIndex ? "is-selected" : ""}
                        key={option.id}
                        onMouseMove={() => {
                          if (index !== slashMenu.selectedIndex) {
                            updateSlashMenu({ ...slashMenu, selectedIndex: index });
                          }
                        }}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          runSlashCommandRef.current(option.id);
                        }}
                      >
                        <span className={`slash-command-icon ${option.id}`}>
                          {option.id === "checklist" ? <CheckSquare size={17} />
                            : option.id === "quote" ? <Quote size={17} />
                              : option.id === "paragraph" ? "T"
                                : option.id.replace("heading-", "H")}
                        </span>
                        <span className="slash-command-copy">
                          <strong>{option.label}</strong>
                          <small>{option.description}</small>
                        </span>
                      </button>
                    ))}
                    {!filtered.length && (
                      <p className="slash-command-empty">No blocks match “{slashMenu.query}”</p>
                    )}
                  </div>
                );
              })()}
            </article>
          ) : (
            <div className="editor-loading">Create a note to begin.</div>
          )}
        </section>
      </main>

      {commentsOpen && (
        <aside className="comments-panel" aria-label="Comments">
          <div className="comments-header">
            <h2>Comments</h2>
            <div className="comment-filter">
              <button className={commentFilter === "open" ? "active" : ""} onClick={() => setCommentFilter("open")}>Open</button>
              <button className={commentFilter === "all" ? "active" : ""} onClick={() => setCommentFilter("all")}>All</button>
            </div>
            <IconButton label="Close comments" onClick={() => { setCommentsOpen(false); setFocusedCommentId(null); }}><X size={17} /></IconButton>
          </div>

          {commenting && selection && (
            <div className="comment-composer">
              <blockquote>“{selection.quote}”</blockquote>
              <textarea autoFocus value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="Leave a comment…" />
              <div className="composer-actions">
                <button onClick={() => { setCommenting(false); setCommentDraft(""); }}>Cancel</button>
                <button className="primary-button compact" disabled={!commentDraft.trim()} onClick={() => void submitComment()}>Comment</button>
              </div>
            </div>
          )}

          <div className="comment-list">
            {activeComments.map((comment) => (
              <article
                className={`comment-card ${comment.status} ${comment.id === focusedCommentId ? "is-focused" : ""}`}
                data-comment-id={comment.id}
                key={comment.id}
                ref={(element) => {
                  if (element) commentCardRefs.current.set(comment.id, element);
                  else commentCardRefs.current.delete(comment.id);
                }}
                tabIndex={-1}
              >
                <blockquote>{comment.detached && <span className="detached-label">Detached · </span>}“{comment.exact_quote}”</blockquote>
                <div className="comment-meta"><strong>{comment.author_name}</strong><span>{new Date(comment.created_at).toLocaleString()}</span></div>
                <p>{comment.body}</p>
                {replies.filter((reply) => reply.comment_id === comment.id).map((reply) => (
                  <div className="reply" key={reply.id}>
                    <div className="comment-meta"><strong>{reply.author_name}</strong><span>{new Date(reply.created_at).toLocaleString()}</span></div>
                    <p>{reply.body}</p>
                  </div>
                ))}
                <textarea
                  className="reply-input"
                  value={replyDrafts[comment.id] ?? ""}
                  onChange={(event) => setReplyDrafts((current) => ({ ...current, [comment.id]: event.target.value }))}
                  placeholder="Reply…"
                />
                <div className="comment-actions">
                  <button disabled={!replyDrafts[comment.id]?.trim()} onClick={() => void handleReply(comment.id)}>Reply</button>
                  <button onClick={() => void handleCommentStatus(comment.id, comment.status === "open" ? "resolved" : "open")}>
                    {comment.status === "open" ? <><Check size={14} /> Resolve</> : "Reopen"}
                  </button>
                </div>
              </article>
            ))}
            {!activeComments.length && !commenting && (
              <div className="comments-empty">
                <MessageCircle size={26} />
                <h3>{commentFilter === "open" ? "All clear" : "No threads yet"}</h3>
                <p>{commentFilter === "open" ? "There are no open threads in this note." : "Select some text to begin a conversation."}</p>
              </div>
            )}
          </div>
        </aside>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSettingsOpen(false);
        }}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow"><ShieldCheck size={14} /> {isSupabaseConfigured ? "Private by default" : "Local preview"}</p>
                <h2 id="settings-title">{isSupabaseConfigured ? "Cloud workspace" : "Local workspace"}</h2>
                <p>{isSupabaseConfigured ? "Your notes, conversations, revisions, and backups are protected by your account." : "Add Supabase credentials to enable private cross-device sync."}</p>
              </div>
              <IconButton label="Close dialog" onClick={() => setSettingsOpen(false)}><X size={18} /></IconButton>
            </div>
            <div className="workspace-overview">
              <div><strong>{documents.length}</strong><span>Notes</span></div>
              <div><strong>{totalThreads}</strong><span>Threads</span></div>
              <div><strong>{openThreads}</strong><span>Open comments</span></div>
            </div>
            <div className="setting-row">
              <div><h3>Display name</h3><p>Shown on comments you write in this browser.</p></div>
              <input defaultValue={displayName} onBlur={(event) => void handleDisplayName(event.target.value)} aria-label="Display name" />
            </div>
            <div className="setting-row">
              <div><h3>Backup and restore</h3><p>Move all notes and comments with one versioned JSON file.</p></div>
              <div className="setting-actions">
                <button onClick={() => void handleExport()}><Download size={16} /> Export</button>
                <label className="button-label"><Upload size={16} /> Import<input type="file" accept="application/json" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleImport(file);
                }} /></label>
              </div>
            </div>
            <div className="cloud-note">
              <ShieldCheck size={18} />
              <div><strong>{isSupabaseConfigured ? "Versioned and synchronized" : "Ready for Supabase"}</strong>
                <p>{isSupabaseConfigured ? "Every edit creates a database revision. A complete cloud snapshot is saved daily while you use the workspace." : "The deployed app will save revisions and daily workspace snapshots once configured."}</p>
              </div>
            </div>
            {isSupabaseConfigured && (
              <div className="setting-row final-row">
                <div><h3>Signed in</h3><p>{session?.user.email}</p></div>
                <button onClick={() => void signOut()}>Sign out</button>
              </div>
            )}
            {!isSupabaseConfigured && (
              <div className="setting-row final-row">
                <div><h3>Preview data</h3><p>This browser is currently using local storage.</p></div>
              </div>
            )}
          </section>
        </div>
      )}

      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}><X size={16} /></button>
        </div>
      )}
    </div>
  );
}

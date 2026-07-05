/** useSearchProviders — provider list state + CRUD for the Search page (W362).
 *  Loads the configured providers on mount and exposes the toggle/edit/remove/
 *  add-or-update-from-dialog/add-from-catalog mutations SearchPage's provider
 *  chips + dialog need. Extracted from SearchPage (v0.16 onward) with no
 *  behavior change. */
import { useEffect, useState } from "react";
import {
  listProviders,
  addProvider,
  updateProvider,
  removeProvider,
} from "../../../ipc/search";
import type { SearchProvider } from "../../../ipc/search";
import type { ProviderFormData } from "../ProviderDialog";
import { swallow } from "../../../ipc/swallow";

/** Add/edit-provider dialog visibility + which provider (if any) is being edited. */
export interface DialogState {
  open: boolean;
  provider?: SearchProvider;
}

export interface UseSearchProvidersResult {
  providers: SearchProvider[];
  hasProviders: boolean;
  activeCount: number;
  dialog: DialogState;
  catalogOpen: boolean;
  openAddDialog: () => void;
  openEditDialog: (provider: SearchProvider) => void;
  closeDialog: () => void;
  openCatalog: () => void;
  closeCatalog: () => void;
  toggleProvider: (id: number) => Promise<void>;
  removeProviderById: (id: number) => Promise<void>;
  saveDialog: (data: ProviderFormData) => Promise<void>;
  addFromCatalog: (created: SearchProvider) => void;
}

/** Loads providers on mount (a fetch failure simply leaves the list empty —
 *  the empty state below guides the user to add one) and exposes CRUD + the
 *  add/edit dialog and catalog-sheet visibility. */
export function useSearchProviders(): UseSearchProvidersResult {
  const [providers, setProviders] = useState<SearchProvider[]>([]);
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const [catalogOpen, setCatalogOpen] = useState(false);

  useEffect(() => {
    listProviders()
      .then(setProviders)
      .catch((err: unknown) => {
        setProviders([]);
        swallow(err, "useSearchProviders.load");
      });
  }, []);

  async function toggleProvider(id: number) {
    const p = providers.find((x) => x.id === id);
    if (!p) return;
    const updated = await updateProvider({ id, enabled: !p.enabled });
    setProviders((prev) => prev.map((x) => (x.id === id ? updated : x)));
  }

  async function removeProviderById(id: number) {
    await removeProvider({ id });
    setProviders((prev) => prev.filter((x) => x.id !== id));
  }

  async function saveDialog(data: ProviderFormData) {
    if (dialog.provider) {
      const updated = await updateProvider({
        id: dialog.provider.id,
        name: data.name,
        urlTemplate: data.urlTemplate,
        kind: data.kind,
        directDownload: data.directDownload,
        composeFilters: data.composeFilters,
      });
      setProviders((prev) =>
        prev.map((x) => (x.id === dialog.provider!.id ? updated : x))
      );
    } else {
      const created = await addProvider(data);
      setProviders((prev) => [...prev, created]);
    }
    setDialog({ open: false });
  }

  // A provider added from the catalog sheet (v0.20) — append if new.
  function addFromCatalog(created: SearchProvider) {
    setProviders((prev) =>
      prev.some((p) => p.id === created.id) ? prev : [...prev, created]
    );
  }

  return {
    providers,
    hasProviders: providers.length > 0,
    activeCount: providers.filter((p) => p.enabled).length,
    dialog,
    catalogOpen,
    openAddDialog: () => setDialog({ open: true }),
    openEditDialog: (provider) => setDialog({ open: true, provider }),
    closeDialog: () => setDialog({ open: false }),
    openCatalog: () => setCatalogOpen(true),
    closeCatalog: () => setCatalogOpen(false),
    toggleProvider,
    removeProviderById,
    saveDialog,
    addFromCatalog,
  };
}

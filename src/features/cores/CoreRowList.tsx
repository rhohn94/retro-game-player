// CoreRowList — renders a list of CoreRow entries for one system, wiring each
// row's install/update/activate callbacks through the shared useCores mutation
// functions. Extracted in W366 from the two identical CoreRow-mapping blocks
// in CoresPage.tsx (the search-results list and the per-system detail list).

import { CoreRow } from "./CoreRow";
import type { Core } from "../../ipc/commands";
import type { CoreAction, CoreError } from "./useCores";

export interface CoreRowListProps {
  cores: Core[];
  actionState: (system: string, coreId: string) => CoreAction;
  actionError: (system: string, coreId: string) => CoreError | null;
  install: (system: string, coreId: string) => Promise<void>;
  update: (core: Core) => Promise<void>;
  activate: (system: string, coreId: string) => Promise<void>;
}

/** Renders one CoreRow per core, wiring its action callbacks. */
export function CoreRowList(props: CoreRowListProps) {
  const { cores, actionState, actionError, install, update, activate } = props;

  return (
    <>
      {cores.map((core) => (
        <CoreRow
          key={core.coreId}
          core={core}
          action={actionState(core.system, core.coreId)}
          error={actionError(core.system, core.coreId)}
          onInstall={() => void install(core.system, core.coreId)}
          onUpdate={() => void update(core)}
          onActivate={() => void activate(core.system, core.coreId)}
        />
      ))}
    </>
  );
}

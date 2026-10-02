import { type ReactElement, useEffect } from "react";
import { appState, toast } from "./app/appState";
import { installShortcuts } from "./app/shortcuts";
import { documentStore, startSession } from "./app/session";
import { useStore } from "./app/tinyStore";
import {
  FabricationMain,
  FabricationSidePanel,
  FabricationTabs,
  exportSheets,
  useFabrication,
} from "./fabrication";
import { HelpMenu } from "./help/HelpMenu";
import { HelpOverlay } from "./help/HelpOverlay";
import { BrowserTree } from "./panels/BrowserTree";
import { MeasurePanel } from "./measure/MeasurePanel";
import { ContextMenu } from "./panels/ContextMenu";
import { FeatureDialog } from "./panels/FeatureDialog";
import { SketchToolPanel } from "./panels/SketchToolPanel";
import { Header, openProject } from "./panels/Header";
import { ImportDxfDialog } from "./panels/ImportDxfDialog";
import { AboutDialog, ParametersDialog } from "./panels/ParametersDialog";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { Ribbon } from "./panels/Ribbon";
import { StatusBar } from "./panels/StatusBar";
import { Timeline } from "./panels/Timeline";
import { Toasts } from "./panels/Toasts";
import { PrintSidePanel, PrintView, exportPrintJob, usePrintJob } from "./print";
import { TextDialog } from "./text/TextDialog";
import { TouchBar } from "./viewport/TouchBar";
import { Viewport } from "./viewport/Viewport";

/**
 * Exporting manufacturing data works from any workspace, so the fabrication pipeline is kept
 * alive by a component that renders nothing.
 */
function FabricationExportBridge({
  register,
}: {
  register: (fn: (format: "svg" | "dxf") => void) => void;
}): null {
  const fabrication = useFabrication();
  useEffect(() => {
    register((format) => {
      const { output, settings, status, stale } = fabrication;
      if (!output || output.parts.length === 0) {
        toast(
          status === "loading"
            ? "The parts are still being computed. Try again in a moment."
            : "There are no parts to export. Design a body first.",
          "warning",
        );
        return;
      }
      if (stale) {
        toast("The model is still being recomputed. Try again in a moment.", "warning");
        return;
      }
      exportSheets(format, output, documentStore.document.name, settings.exportLabels);
    });
  }, [fabrication, register]);
  return null;
}

let exportHandler: (format: "svg" | "dxf") => void = () => undefined;
const registerExport = (fn: (format: "svg" | "dxf") => void): void => {
  exportHandler = fn;
};

let printExportHandler: (format: "stl" | "3mf") => void = () => undefined;
const registerPrintExport = (fn: (format: "stl" | "3mf") => void): void => {
  printExportHandler = fn;
};

export function App(): ReactElement {
  const workspace = useStore(appState, (s) => s.workspace);
  const fabricationTab = useStore(appState, (s) => s.fabricationTab);
  const dialog = useStore(appState, (s) => s.dialog);
  const sidePanelOpen = useStore(appState, (s) => s.sidePanelOpen);

  useEffect(() => {
    startSession();
    return installShortcuts({ openProject: () => void openProject() });
  }, []);

  const process = useStore(appState, (s) => s.fabricationProcess);
  const print = usePrintJob();
  const fabrication = workspace === "fabrication";
  const printing = fabrication && process === "print";
  const showViewport = !fabrication || (!printing && fabricationTab === "model");

  useEffect(() => {
    registerPrintExport((format) =>
      exportPrintJob(format, print.job, documentStore.document.name),
    );
  }, [print.job]);

  return (
    <div className={`app${fabrication ? " no-timeline" : ""}`}>
      <Header
        onExportFabrication={(format) => exportHandler(format)}
        onExportPrint={(format) => printExportHandler(format)}
      />
      <Ribbon />
      {sidePanelOpen && (
        <div className="side-backdrop" onPointerDown={() => appState.set({ sidePanelOpen: false })} />
      )}
      <aside className={`side${sidePanelOpen ? " open" : ""}`}>
        <button
          className="side-grip"
          aria-label="Close panel"
          onClick={() => appState.set({ sidePanelOpen: false })}
        />
        {printing ? (
          <PrintSidePanel state={print} />
        ) : fabrication ? (
          <FabricationSidePanel />
        ) : (
          <>
            <BrowserTree />
            <PropertiesPanel />
          </>
        )}
      </aside>
      <main className="main">
        {/* The viewport stays mounted so that the WebGL context and the camera survive. */}
        <div style={{ position: "absolute", inset: 0, visibility: showViewport ? "visible" : "hidden" }}>
          <Viewport />
        </div>
        <TouchBar />
        {!fabrication && <FeatureDialog />}
        {!fabrication && <SketchToolPanel />}
        {!fabrication && <MeasurePanel />}
        {!fabrication && <TextDialog />}
        {fabrication && !printing && (
          <>
            <FabricationMain />
            <FabricationTabs />
          </>
        )}
        {printing && <PrintView job={print.job} stale={print.stale} />}
      </main>
      {!fabrication && <Timeline />}
      <StatusBar />
      <Toasts />
      <ContextMenu />
      <HelpMenu />
      <HelpOverlay />
      {dialog?.type === "parameters" && <ParametersDialog />}
      {dialog?.type === "about" && <AboutDialog />}
      {dialog?.type === "import-dxf" && (
        <ImportDxfDialog fileName={dialog.fileName} drawing={dialog.drawing} />
      )}
      <FabricationExportBridge register={registerExport} />
    </div>
  );
}

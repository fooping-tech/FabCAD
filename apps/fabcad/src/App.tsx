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
import { fabricationSummary, noPartsMessage } from "./fabrication/pipeline";
import { fabricationLog } from "./app/copyHistoryLog";
import { HelpMenu } from "./help/HelpMenu";
import { HelpOverlay } from "./help/HelpOverlay";
import { BrowserTree } from "./panels/BrowserTree";
import { MeasurePanel } from "./measure/MeasurePanel";
import { ContextMenu } from "./panels/ContextMenu";
import { FeatureDialog } from "./panels/FeatureDialog";
import { SketchToolPanel } from "./panels/SketchToolPanel";
import { CommandPalette } from "./panels/CommandPalette";
import { HistoryLogPanel } from "./panels/HistoryLogPanel";
import { ShapeDimensionsPanel } from "./panels/ShapeDimensionsPanel";
import { SketchTransformPanel } from "./panels/SketchTransformPanel";
import { Header, openProject } from "./panels/Header";
import { ImportDxfDialog } from "./panels/ImportDxfDialog";
import { InstanceMovePanel } from "./panels/InstanceMovePanel";
import { NewComponentPanel } from "./panels/NewComponentPanel";
import { ExportModelPanel } from "./panels/ExportModelPanel";
import { AboutDialog, ParametersDialog } from "./panels/ParametersDialog";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { Ribbon } from "./panels/Ribbon";
import { StatusBar } from "./panels/StatusBar";
import { Timeline } from "./panels/Timeline";
import { Toasts } from "./panels/Toasts";
import { PrintSidePanel, PrintView, usePrintJob } from "./print";
import { openExportModel } from "./app/actions";
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
  // The history log reports what would be cut, whatever the workspace.
  useEffect(() => {
    const out = fabrication.output;
    fabricationLog.set({ lines: out && fabrication.status !== "loading" ? fabricationSummary(out) : null });
  }, [fabrication.output, fabrication.status]);
  useEffect(() => {
    register((format) => {
      const { output, settings, status, stale } = fabrication;
      if (!output || output.parts.length === 0) {
        toast(
          status === "loading"
            ? "The parts are still being computed. Try again in a moment."
            : noPartsMessage(output),
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

/** 3MF / STL of the 3D Print job: a window chooses the bodies and components first. */
const openPrintExport = (format: "stl" | "3mf"): void =>
  openExportModel(format === "3mf" ? "3mf" : "print-stl");

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

  return (
    <div className={`app${fabrication ? " no-timeline" : ""}`}>
      <Header
        onExportFabrication={(format) => exportHandler(format)}
        onExportPrint={openPrintExport}
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
        {!fabrication && <ShapeDimensionsPanel />}
        {!fabrication && <SketchTransformPanel />}

        {!fabrication && <MeasurePanel />}
        {!fabrication && <InstanceMovePanel />}
        {!fabrication && <NewComponentPanel />}
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
      <HistoryLogPanel />
      <CommandPalette
        exportFabrication={(format) => exportHandler(format)}
        exportPrint={openPrintExport}
      />
      <ExportModelPanel />
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

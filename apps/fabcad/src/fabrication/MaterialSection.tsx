import {
  type MaterialCategory,
  type MaterialProfile,
  describeMaterial,
} from "@fabcad/fabrication-core";
import { type ReactNode, useId, useState } from "react";
import { NumberField, Section, SegmentedField, TextField } from "./fields";
import {
  type LaserFabricationSettings,
  allMaterials,
  builtInMaterial,
  currentMaterial,
  materialOrigin,
  newMaterialId,
  updateFabricationSettings,
  withMaterial,
  withoutMaterial,
} from "./settings";

const CATEGORY_LABEL: Record<MaterialCategory, string> = {
  board: "Board",
  paper: "Paper",
};
const CATEGORIES: readonly MaterialCategory[] = ["board", "paper"];

const THICKNESS_RULE = { min: 0, exclusiveMin: true, max: 100 } as const;
const KERF_RULE = { min: 0, max: 5 } as const;
const FIT_RULE = { min: -5, max: 5 } as const;

function editMaterial(patch: Partial<MaterialProfile>): void {
  updateFabricationSettings(
    (s) => withMaterial(s, { ...currentMaterial(s), ...patch }),
    "Edit material",
  );
}

interface NewMaterialFormProps {
  initialCategory: MaterialCategory;
  onDone: () => void;
}

function NewMaterialForm({ initialCategory, onDone }: NewMaterialFormProps): ReactNode {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<MaterialCategory>(initialCategory);
  const [thickness, setThickness] = useState<number | undefined>(3);
  const [kerf, setKerf] = useState<number | undefined>(initialCategory === "paper" ? 0 : 0.15);
  const [fitOffset, setFitOffset] = useState<number | undefined>(0);
  const nameId = useId();
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && thickness !== undefined;

  const add = (): void => {
    if (!valid || thickness === undefined) return;
    updateFabricationSettings((s) => {
      const material: MaterialProfile = {
        id: newMaterialId(s, trimmed),
        name: trimmed,
        category,
        thickness,
        kerf: kerf ?? 0,
        fitOffset: fitOffset ?? 0,
      };
      return { ...withMaterial(s, material), materialId: material.id };
    }, "Add material");
    onDone();
  };

  return (
    <div className="fab-subform" role="group" aria-label="New material">
      <div className="field">
        <label htmlFor={nameId}>Name</label>
        <input
          id={nameId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={name}
          placeholder="e.g. Plywood 3 mm"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
            e.stopPropagation();
          }}
        />
      </div>
      <SegmentedField
        label="Category"
        value={category}
        options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
        onChange={setCategory}
      />
      <NumberField label="Thickness" unit="mm" value={thickness} rule={THICKNESS_RULE} onCommit={setThickness} />
      <NumberField label="Kerf" unit="mm" value={kerf} rule={KERF_RULE} onCommit={setKerf} />
      <NumberField label="Fit offset" unit="mm" value={fitOffset} rule={FIT_RULE} onCommit={setFitOffset} />
      <div className="fab-row end">
        <button type="button" className="btn small" onClick={onDone}>
          Cancel
        </button>
        <button type="button" className="btn small accent" disabled={!valid} onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

interface MaterialSectionProps {
  settings: LaserFabricationSettings;
}

export function MaterialSection({ settings }: MaterialSectionProps): ReactNode {
  const [adding, setAdding] = useState(false);
  const selectId = useId();
  const materials = allMaterials(settings);
  const material = currentMaterial(settings);
  const origin = materialOrigin(settings, material.id);
  const preset = builtInMaterial(material.id);

  return (
    <Section title="Material" badge={<span className="badge">{CATEGORY_LABEL[material.category]}</span>}>
      <div className="form">
        <div className="field">
          <label htmlFor={selectId}>Material</label>
          <select
            id={selectId}
            value={material.id}
            onChange={(e) =>
              updateFabricationSettings({ materialId: e.target.value }, "Change material")
            }
          >
            {CATEGORIES.map((category) => (
              <optgroup key={category} label={CATEGORY_LABEL[category]}>
                {materials
                  .filter((m) => m.category === category)
                  .map((m) => {
                    const o = materialOrigin(settings, m.id);
                    const mark = o === "edited" ? " (edited)" : o === "custom" ? " (custom)" : "";
                    return (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {mark}
                      </option>
                    );
                  })}
              </optgroup>
            ))}
          </select>
        </div>
        {origin === "custom" ? (
          <TextField label="Name" value={material.name} onCommit={(name) => editMaterial({ name })} />
        ) : null}
        <NumberField
          label="Thickness"
          unit="mm"
          value={material.thickness}
          rule={THICKNESS_RULE}
          onCommit={(v) => {
            if (v !== undefined) editMaterial({ thickness: v });
          }}
        />
        <NumberField
          label="Kerf"
          unit="mm"
          value={material.kerf}
          rule={KERF_RULE}
          hint="Width removed by the beam"
          onCommit={(v) => {
            if (v !== undefined) editMaterial({ kerf: v });
          }}
        />
        <NumberField
          label="Fit offset"
          unit="mm"
          value={material.fitOffset}
          rule={FIT_RULE}
          hint="Slot clearance, negative = press fit"
          onCommit={(v) => {
            if (v !== undefined) editMaterial({ fitOffset: v });
          }}
        />
        <div className="fab-row spread">
          <span className="value-preview" title="Material used for all parts">
            {describeMaterial(material)}
          </span>
          <span className="fab-row">
            {origin === "edited" && preset ? (
              <button
                type="button"
                className="btn small"
                title={`Back to the preset: ${preset.thickness} mm, kerf ${preset.kerf} mm, fit ${preset.fitOffset} mm`}
                onClick={() =>
                  updateFabricationSettings((s) => withoutMaterial(s, material.id), "Reset material")
                }
              >
                Reset
              </button>
            ) : null}
            {origin === "custom" ? (
              <button
                type="button"
                className="btn small danger"
                onClick={() =>
                  updateFabricationSettings((s) => withoutMaterial(s, material.id), "Delete material")
                }
              >
                Delete
              </button>
            ) : null}
            {adding ? null : (
              <button type="button" className="btn small" onClick={() => setAdding(true)}>
                Add material
              </button>
            )}
          </span>
        </div>
        {adding ? (
          <NewMaterialForm initialCategory={material.category} onDone={() => setAdding(false)} />
        ) : null}
      </div>
    </Section>
  );
}

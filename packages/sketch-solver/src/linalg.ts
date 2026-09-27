/**
 * Small dense / sparse linear algebra kernel for the sketch solver. Sketches have tens to a few
 * hundred variables, so dense factorizations are fine; only the Jacobian itself is kept sparse
 * because every residual touches a handful of variables.
 */

/**
 * Sparse matrix in compressed-row form with a fixed sparsity pattern. Row `i` owns the entries
 * `rowStart[i] .. rowStart[i + 1] - 1` of `cols` / `values`.
 */
export interface SparseRows {
  rows: number;
  columns: number;
  rowStart: Int32Array;
  cols: Int32Array;
  values: Float64Array;
}

/**
 * Column view of a {@link SparseRows} pattern: for column `j` the entries
 * `colStart[j] .. colStart[j + 1] - 1` give the owning row and the position in `values`.
 */
export interface ColumnIndex {
  colStart: Int32Array;
  rowOf: Int32Array;
  position: Int32Array;
}

export function buildColumnIndex(m: SparseRows): ColumnIndex {
  const nnz = m.cols.length;
  const colStart = new Int32Array(m.columns + 1);
  for (let k = 0; k < nnz; k++) colStart[m.cols[k]! + 1]!++;
  for (let j = 0; j < m.columns; j++) colStart[j + 1] = colStart[j + 1]! + colStart[j]!;
  const cursor = colStart.slice(0, m.columns);
  const rowOf = new Int32Array(nnz);
  const position = new Int32Array(nnz);
  for (let i = 0; i < m.rows; i++) {
    for (let k = m.rowStart[i]!; k < m.rowStart[i + 1]!; k++) {
      const j = m.cols[k]!;
      const at = cursor[j]!;
      cursor[j] = at + 1;
      rowOf[at] = i;
      position[at] = k;
    }
  }
  return { colStart, rowOf, position };
}

/** Dense `A = J · diag(w) · Jᵀ` (row-major, `rows × rows`), exploiting the sparsity of `J`. */
export function weightedGram(
  j: SparseRows,
  index: ColumnIndex,
  w: Float64Array,
  out: Float64Array,
): void {
  const m = j.rows;
  out.fill(0);
  for (let c = 0; c < j.columns; c++) {
    const from = index.colStart[c]!;
    const to = index.colStart[c + 1]!;
    const wc = w[c]!;
    for (let a = from; a < to; a++) {
      const va = j.values[index.position[a]!]! * wc;
      if (va === 0) continue;
      const rowA = index.rowOf[a]! * m;
      for (let b = from; b < to; b++) {
        out[rowA + index.rowOf[b]!]! += va * j.values[index.position[b]!]!;
      }
    }
  }
}

/** `out = diag(w) · Jᵀ · y`. */
export function weightedTransposeApply(
  j: SparseRows,
  w: Float64Array,
  y: Float64Array,
  out: Float64Array,
): void {
  out.fill(0);
  for (let i = 0; i < j.rows; i++) {
    const yi = y[i]!;
    if (yi === 0) continue;
    for (let k = j.rowStart[i]!; k < j.rowStart[i + 1]!; k++) {
      out[j.cols[k]!]! += j.values[k]! * yi;
    }
  }
  for (let c = 0; c < j.columns; c++) out[c] = out[c]! * w[c]!;
}

/**
 * In-place Cholesky factorization `A = L·Lᵀ` of a dense symmetric matrix (row-major, `n × n`);
 * `L` overwrites the lower triangle. Returns false when the matrix is not numerically positive
 * definite.
 */
export function choleskyFactor(a: Float64Array, n: number): boolean {
  for (let j = 0; j < n; j++) {
    const rowJ = j * n;
    let d = a[rowJ + j]!;
    for (let k = 0; k < j; k++) {
      const l = a[rowJ + k]!;
      d -= l * l;
    }
    if (!(d > 0) || !Number.isFinite(d)) return false;
    const diag = Math.sqrt(d);
    a[rowJ + j] = diag;
    for (let i = j + 1; i < n; i++) {
      const rowI = i * n;
      let s = a[rowI + j]!;
      for (let k = 0; k < j; k++) s -= a[rowI + k]! * a[rowJ + k]!;
      a[rowI + j] = s / diag;
    }
  }
  return true;
}

/** Solve `L·Lᵀ·x = b` in place (`b` becomes `x`) using a factor from {@link choleskyFactor}. */
export function choleskySolve(l: Float64Array, n: number, b: Float64Array): void {
  for (let i = 0; i < n; i++) {
    const row = i * n;
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= l[row + k]! * b[k]!;
    b[i] = s / l[row + i]!;
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]!;
    for (let k = i + 1; k < n; k++) s -= l[k * n + i]! * b[k]!;
    b[i] = s / l[i * n + i]!;
  }
}

/**
 * Incremental rank computation by Gaussian elimination. Rows are offered one at a time; each
 * row is reduced against the pivots of the independent rows accepted so far and is itself
 * accepted (with its largest remaining entry as pivot) when something significant is left.
 * This yields both the rank and, per row, whether it added information.
 */
export class RankTracker {
  private readonly basis: Float64Array[] = [];
  private readonly pivots: number[] = [];
  private readonly work: Float64Array;

  /**
   * @param columns number of variables
   * @param tolerance a row counts as dependent when, after elimination, its largest entry is
   *   below `tolerance` times the original row norm
   */
  constructor(
    private readonly columns: number,
    private readonly tolerance = 1e-6,
  ) {
    this.work = new Float64Array(columns);
  }

  get rank(): number {
    return this.basis.length;
  }

  /** Offer row `i` of `m`. Returns true when the row increased the rank. */
  addRow(m: SparseRows, i: number): boolean {
    const row = this.work;
    row.fill(0);
    let norm = 0;
    for (let k = m.rowStart[i]!; k < m.rowStart[i + 1]!; k++) {
      const v = m.values[k]!;
      row[m.cols[k]!]! += v;
      norm += v * v;
    }
    norm = Math.sqrt(norm);
    if (!(norm > 1e-12) || this.basis.length >= this.columns) return false;

    const n = this.columns;
    for (let b = 0; b < this.basis.length; b++) {
      const f = row[this.pivots[b]!]!;
      if (f === 0) continue;
      const basisRow = this.basis[b]!;
      for (let c = 0; c < n; c++) row[c] = row[c]! - f * basisRow[c]!;
      row[this.pivots[b]!] = 0;
    }

    let pivot = -1;
    let best = 0;
    for (let c = 0; c < n; c++) {
      const v = Math.abs(row[c]!);
      if (v > best) {
        best = v;
        pivot = c;
      }
    }
    if (pivot < 0 || best <= this.tolerance * norm) return false;

    const stored = new Float64Array(n);
    const inv = 1 / row[pivot]!;
    for (let c = 0; c < n; c++) stored[c] = row[c]! * inv;
    stored[pivot] = 1;
    this.basis.push(stored);
    this.pivots.push(pivot);
    return true;
  }
}

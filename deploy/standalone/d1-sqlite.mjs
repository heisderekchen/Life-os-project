/** Small D1-compatible adapter for the private Life OS Worker module. */
export function createD1Sqlite(db) {
  const prepare = sql => {
    let values = []
    const bound = {
      bind(...args) { values = args; return bound },
      first() { return db.prepare(sql).get(...values) ?? null },
      all() {
        const results = db.prepare(sql).all(...values)
        return { results, success: true, meta: { changes: 0, rows_read: results.length } }
      },
      run() {
        const result = db.prepare(sql).run(...values)
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0), rows_written: Number(result.changes) } }
      },
    }
    return bound
  }
  return {
    prepare,
    batch(statements) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const results = statements.map(statement => statement.run())
        db.exec('COMMIT')
        return results
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
}

export class PostgresPoolAdapter {
  constructor(sql) {
    this.sql = sql
  }

  async query(text, params = []) {
    const rows = await this.sql.unsafe(text, params)
    return { rows, rowCount: rows.count ?? rows.length }
  }

  async connect() {
    const reserved = await this.sql.reserve()
    return {
      query: async (text, params = []) => {
        const rows = await reserved.unsafe(text, params)
        return { rows, rowCount: rows.count ?? rows.length }
      },
      release: () => reserved.release(),
    }
  }

  end() {
    return this.sql.end()
  }
}

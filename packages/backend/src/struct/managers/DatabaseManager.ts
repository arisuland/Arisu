/**
 * Copyright (c) 2020 August
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { Repository, convertColumnToSql } from '../internals/Repository';
import { createLogger, Logger } from '@augu/logging';
import OrganisationRepository from '../repository/OrganisationRepository';
import PermissionsRepository from '../repository/PermissionsRepository';
import ProjectsRepository from '../repository/ProjectRepository';
import type { Website } from '../internals/Website';
import UserRepository from '../repository/UserRepository';
import { Collection } from '@augu/immutable';
import { EventBus } from '../internals';
import pg from 'pg';

interface DatabaseExistsArgs {
  exists: boolean;
}

// eslint-disable-next-line
type Events = {
  offline: () => void;
  online: () => void;
};

export default class DatabaseManager extends EventBus<Events> {
  public repositories: Collection<Repository> = new Collection();
  public connected: boolean = false;
  private client!: pg.PoolClient;
  private website: Website;
  private logger: Logger;
  public checked: boolean = false;
  public pool: pg.Pool;

  constructor(website: Website) {
    super();

    this.website = website;
    this.logger = createLogger('Database');
    this.pool = new pg.Pool({
      database: website.config.get<string>('database.name', 'i18n'),
      password: website.config.get<string>('database.password')!,
      user: website.config.get<string>('database.username')!,
      host: website.config.get<string>('database.host')!,
      port: website.config.get<number>('database.port')!
    });
  }

  private async _addRepos() {
    const permissions = new PermissionsRepository();
    const orgs = new OrganisationRepository();
    const projects = new ProjectsRepository();
    const users = new UserRepository();

    for (const repo of [orgs, projects, users, permissions]) {
      repo.init(this.website);
      if (!(this.exists(repo.table))) await this.website.database.createTable(repo);
    }

    this.repositories.set('organisations', orgs);
    this.repositories.set('permissions', permissions);
    this.repositories.set('projects', projects);
    this.repositories.set('users', users);
  }

  async connect() {
    this.client = await this.pool.connect();
    await this._addRepos();
    
    this.emit('online');
    this.connected = true;
  }

  async dispose() {
    await this.pool.end();
    this.connected = false;

    this.emit('offline');
  }

  query<T>(query: string | pg.QueryConfig<T[]>) {
    this.website.analytics.inc('dbCalls');
    return new Promise<T | null>((resolve) => this.client.query(query).then((result: pg.QueryResult<T>) => {
      if (result.rowCount < 1) return resolve(null);
      else return resolve(result.rows[0]);
    }));
  }

  async createTable(repository: Repository) {
    const columns = `(${repository.columns.map(convertColumnToSql).join(', ')})`;
    await this.query(`CREATE TABLE IF NOT EXISTS ${repository.table.toLowerCase()} ${columns}`);
  }

  async exists(name: string) {
    const data = await this.query(`SELECT to_regclass('${name}')`);
    return data != null;
  }

  getRepository(name: 'organisations'): OrganisationRepository;
  getRepository(name: 'permissions'): PermissionsRepository;
  getRepository(name: 'projects'): ProjectsRepository;
  getRepository(name: 'users'): UserRepository;
  getRepository(name: string) {
    return this.repositories.get(name)!;
  }

  count(table: string) {
    return this.query<number>(`SELECT count(*) FROM ${table}`);
  }
}
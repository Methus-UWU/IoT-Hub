import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import { FileSizePipe } from '../../../shared/pipes/file-size.pipe';
import { DatabaseStore } from './database.store';

@Component({
  selector: 'app-database-page',
  imports: [FileSizePipe, DatePipe, DecimalPipe],
  providers: [DatabaseStore],
  templateUrl: './database.page.html',
  styleUrl: './database.page.css',
})
export class DatabasePage {
  protected readonly store = inject(DatabaseStore);

  constructor() {
    this.store.load();
  }
}

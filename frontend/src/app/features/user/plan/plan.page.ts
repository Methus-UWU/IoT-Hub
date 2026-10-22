import { Component, inject } from '@angular/core';

import { ProjectStore } from '../projects/project.store';

interface PlanUsage {
  label: string;
  value: string;
  limit: string;
  percent: number;
}

@Component({
  selector: 'app-plan-page',
  templateUrl: './plan.page.html',
  styleUrl: './plan.page.css',
})
export class PlanPage {
  private readonly projectStore = inject(ProjectStore);

  protected readonly projectCount = this.projectStore.projectCount;
  protected readonly usage: readonly PlanUsage[] = [
    { label: 'เครดิต AI', value: '1,240', limit: '5,000 ต่อเดือน', percent: 25 },
    { label: 'เวลาบิลด์', value: '18 นาที', limit: '120 นาทีต่อเดือน', percent: 15 },
    { label: 'พื้นที่เก็บโปรเจกต์', value: '84 MB', limit: '1 GB', percent: 8 },
    { label: 'เว็บที่นำขึ้นใช้งาน', value: 'ใช้งาน 2 รายการ', limit: 'รวม 3 รายการ', percent: 67 },
  ];
}

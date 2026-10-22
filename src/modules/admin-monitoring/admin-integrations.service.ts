import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SupabaseConfig } from '../../common/config/supabase.config';
import { AdminMonitoringRepository } from './admin-monitoring.repository';

type IntegrationStatus =
  'connected' | 'configured' | 'unavailable' | 'not_configured';

export interface IntegrationStatusItem {
  id: string;
  name: string;
  description: string;
  status: IntegrationStatus;
  detail: string;
  checkedAt: string;
}

@Injectable()
export class AdminIntegrationsService {
  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseConfig,
    private readonly monitoring: AdminMonitoringRepository,
  ) {}

  async list(): Promise<IntegrationStatusItem[]> {
    const checkedAt = new Date().toISOString();
    const database = await this.databaseStatus(checkedAt);
    const supabaseConfigured = this.supabase.canPerformAdminOperations;
    const openRouterConfigured = Boolean(
      this.config.get<string>('OPENROUTER_API_KEY')?.trim(),
    );

    return [
      database,
      {
        id: 'supabase-auth-storage',
        name: 'Supabase Auth & Storage',
        description: 'การยืนยันตัวตนและพื้นที่จัดเก็บไฟล์ส่วนตัว',
        status: supabaseConfigured ? 'configured' : 'not_configured',
        detail: supabaseConfigured
          ? 'ตั้งค่า URL และ secret key แล้ว การเชื่อมต่อจริงจะถูกตรวจเมื่อมีการใช้งาน'
          : 'ยังตั้งค่า SUPABASE_URL และ SUPABASE_SECRET_KEY ไม่ครบ',
        checkedAt,
      },
      {
        id: 'openrouter',
        name: 'OpenRouter',
        description: 'ผู้ให้บริการโมเดลสำหรับ AI Assistant',
        status: openRouterConfigured ? 'configured' : 'not_configured',
        detail: openRouterConfigured
          ? 'ตั้งค่า API key แล้ว การเชื่อมต่อจริงจะถูกตรวจเมื่อมีคำขอ AI'
          : 'ยังไม่ได้ตั้งค่า OPENROUTER_API_KEY',
        checkedAt,
      },
    ];
  }

  private async databaseStatus(
    checkedAt: string,
  ): Promise<IntegrationStatusItem> {
    try {
      const health = await this.monitoring.readDatabaseHealth();
      return {
        id: 'postgresql',
        name: 'Supabase PostgreSQL',
        description: 'ฐานข้อมูลหลักของผู้ใช้ โปรเจกต์ และชุมชน',
        status: 'connected',
        detail: `เชื่อมต่อแล้ว (${health.latencyMs} ms, ${health.activeConnections} connections)`,
        checkedAt,
      };
    } catch {
      return {
        id: 'postgresql',
        name: 'Supabase PostgreSQL',
        description: 'ฐานข้อมูลหลักของผู้ใช้ โปรเจกต์ และชุมชน',
        status: 'unavailable',
        detail: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้',
        checkedAt,
      };
    }
  }
}

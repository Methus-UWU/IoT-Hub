import { DecimalPipe, NgOptimizedImage } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

type BillingPeriod = 'monthly' | 'annual';

interface PlanDefinition {
  readonly name: string;
  readonly description: string;
  readonly monthlyPrice: number;
  readonly annualPrice: number;
  readonly callToAction: string;
  readonly featured: boolean;
  readonly features: readonly string[];
  readonly retention: string;
}

interface PricingCard extends PlanDefinition {
  readonly price: number;
}

interface ModelPartner {
  readonly name: string;
  readonly logo: string;
}

const PLANS: readonly PlanDefinition[] = [
  {
    name: 'Free',
    description: 'สำหรับลองเล่นไอเดีย IoT และสร้างแดชบอร์ดตัวแรกของคุณ',
    monthlyPrice: 0,
    annualPrice: 0,
    callToAction: 'เริ่มใช้ฟรี',
    featured: false,
    features: [
      '2 โปรเจกต์',
      '10 วิดเจ็ต',
      'วิดเจ็ตแบบฟรีเท่านั้น',
      'โมเดล AI ที่คัดมาให้',
      'ติดตามอุปกรณ์แบบพื้นฐาน',
      'ซัพพอร์ตผ่านคอมมูนิตี้',
    ],
    retention: 'ไม่เก็บ log และข้อมูลย้อนหลัง',
  },
  {
    name: 'Go',
    description: 'สำหรับเมกเกอร์และทีมเล็กที่พร้อมสร้างเวิร์กโฟลว์ IoT ครบวงจร',
    monthlyPrice: 659,
    annualPrice: 593,
    callToAction: 'เลือกแพ็ก Go',
    featured: true,
    features: [
      'ทุกอย่างในแพ็ก Free',
      '20 โปรเจกต์',
      '20 วิดเจ็ต',
      'ปลดล็อกวิดเจ็ตทุกประเภท',
      'โมเดล AI มากขึ้น',
      'โควตาใช้งาน AI สูงขึ้น',
      'ซัพพอร์ตทางอีเมล',
    ],
    retention: 'เก็บ log และข้อมูลย้อนหลัง 7 วัน',
  },
  {
    name: 'Plus',
    description: 'สำหรับทีมมืออาชีพที่รันระบบ IoT ขั้นสูงระดับใช้งานจริง',
    monthlyPrice: 3590,
    annualPrice: 3231,
    callToAction: 'เลือกแพ็ก Plus',
    featured: false,
    features: [
      'ทุกอย่างในแพ็ก Go',
      'โปรเจกต์ไม่จำกัด',
      'วิดเจ็ตไม่จำกัด',
      'โมเดล AI ครบทุกตัว',
      'โควตาใช้งาน AI แบบขยาย',
      'วิเคราะห์ข้อมูลขั้นสูงและส่งออกข้อมูล',
      'ซัพพอร์ตแบบเร่งด่วน',
    ],
    retention: 'เก็บ log และข้อมูลย้อนหลัง 14 วัน',
  },
];

const MODEL_PARTNERS: readonly ModelPartner[] = [
  { name: 'Gemini', logo: '/gemini.svg' },
  { name: 'ChatGPT', logo: '/openai.svg' },
  { name: 'Claude', logo: '/claude.svg' },
  { name: 'DeepSeek', logo: '/deepseek.svg' },
];

@Component({
  selector: 'app-pricing',
  imports: [DecimalPipe, NgOptimizedImage, RouterLink],
  templateUrl: './pricing.html',
  styleUrl: './pricing.css',
})
export class Pricing {
  protected readonly billingPeriod = signal<BillingPeriod>('monthly');
  protected readonly modelPartners = MODEL_PARTNERS;
  protected readonly plans = computed<readonly PricingCard[]>(() => {
    const period = this.billingPeriod();

    return PLANS.map((plan) => ({
      ...plan,
      price: period === 'monthly' ? plan.monthlyPrice : plan.annualPrice,
    }));
  });

  protected setBillingPeriod(period: BillingPeriod): void {
    this.billingPeriod.set(period);
  }

  protected toggleBillingPeriod(): void {
    this.billingPeriod.update((period) => (period === 'monthly' ? 'annual' : 'monthly'));
  }
}

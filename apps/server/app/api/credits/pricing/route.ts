import { NextResponse } from 'next/server';
import { BUNDLES, FREE_TIER_CREDITS } from '@/lib/credits/prices';

/**
 * GET /api/credits/pricing
 * Public SKU table for the marketing + top-up UI. No auth.
 */
export async function GET() {
  return NextResponse.json({
    unit: 'USD',
    creditValueCents: 1, // 1 credit = 1¢ at list price
    freeTierCredits: FREE_TIER_CREDITS,
    bundles: BUNDLES,
  });
}

import { prisma } from '../lib/prisma';
import { runDailyBadgeRefresh } from './repeatBadgeJob';

async function main() {
  try {
    await runDailyBadgeRefresh();
    console.log('Repeat badge refresh completed successfully');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Repeat badge refresh failed', error);
  process.exitCode = 1;
});

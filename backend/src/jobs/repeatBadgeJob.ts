import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { recalculateRepeatBadgeForRestaurant } from '../visits/service';

async function runDailyBadgeRefresh() {
  const restaurants = await prisma.restaurant.findMany({
    select: { id: true },
  });

  for (const restaurant of restaurants) {
    await recalculateRepeatBadgeForRestaurant(restaurant.id);
  }
}

export { runDailyBadgeRefresh };

export function startBackgroundJobs() {
  cron.schedule('0 3 * * *', async () => {
    try {
      await runDailyBadgeRefresh();
    } catch (error) {
      console.error('Failed running daily repeat badge job:', error);
    }
  });
}

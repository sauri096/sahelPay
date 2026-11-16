/**
 * Données de démonstration : un admin, un agent avec du float, un marchand et deux clients.
 * Usage : npm run seed
 */
import { migrate, pool } from './pool';
import { createUser } from '../services/auth';
import { getSystemAccountId } from '../services/ledger';
import { issueFloat, cashIn } from '../services/payments';

const DEMO = [
  { phone: '+221770000001', fullName: 'Admin SahelPay', pin: '2580', role: 'admin' as const },
  { phone: '+221770000002', fullName: 'Moussa Diop', pin: '2580', role: 'agent' as const, businessName: 'Boutique Diop - Agent' },
  { phone: '+221770000003', fullName: 'Fatou Ndiaye', pin: '2580', role: 'merchant' as const, businessName: 'Restaurant Teranga' },
  { phone: '+221770000004', fullName: 'Awa Sarr', pin: '2580', role: 'customer' as const },
  { phone: '+221770000005', fullName: 'Ibrahima Fall', pin: '2580', role: 'customer' as const },
];

async function main() {
  await migrate();
  await getSystemAccountId(pool, 'issuance');
  await getSystemAccountId(pool, 'fee_revenue');

  const ids: Record<string, string> = {};
  for (const u of DEMO) {
    const existing = await pool.query(`SELECT id FROM users WHERE phone = $1`, [u.phone]);
    ids[u.role + u.phone] = existing.rows[0]?.id ?? (await createUser(u)).id;
  }
  const admin = ids['admin+221770000001'];
  const agent = ids['agent+221770000002'];

  await issueFloat({ adminId: admin, agentPhone: '+221770000002', amount: 1_000_000, idempotencyKey: 'seed-float' });
  await cashIn({ agentId: agent, customerPhone: '+221770000004', amount: 50_000, pin: '2580', idempotencyKey: 'seed-cashin-1' });
  await cashIn({ agentId: agent, customerPhone: '+221770000005', amount: 25_000, pin: '2580', idempotencyKey: 'seed-cashin-2' });

  const codes = await pool.query(`SELECT phone, role, public_code FROM users ORDER BY phone`);
  console.log('\nComptes de démonstration (PIN : 2580)');
  console.table(codes.rows);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});

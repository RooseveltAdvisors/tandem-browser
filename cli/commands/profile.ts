import { Command } from 'commander';
import { api } from '../client';

export function registerProfile(program: Command): void {
  const cmd = program
    .command('profile')
    .description('Inspect existing Chrome profiles without reading profile data');

  cmd
    .command('list')
    .description('List discovered Chrome profile metadata')
    .action(async () => {
      const result = await api('GET', '/profiles');
      console.log(JSON.stringify(result, null, 2));
    });

  cmd
    .command('select <name>')
    .description('Resolve an exact Chrome profile name and show its selection proof')
    .action(async (name: string) => {
      const result = await api('POST', '/profiles/select', { name });
      console.log(JSON.stringify(result, null, 2));
    });
}

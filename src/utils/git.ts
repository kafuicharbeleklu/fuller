import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface GitInfo {
  isGit: boolean;
  branch?: string;
  isDirty?: boolean;
}

export async function getGitInfo(cwd: string): Promise<GitInfo> {
  try {
    const { stdout: isGitStr } = await execAsync('git rev-parse --is-inside-work-tree', {
      cwd,
      timeout: 2000,
    });
    if (isGitStr.trim() !== 'true') {
      return { isGit: false };
    }

    const { stdout: branchStr } = await execAsync('git branch --show-current', {
      cwd,
      timeout: 2000,
    });
    const branch = branchStr.trim() || 'detached';

    const { stdout: statusStr } = await execAsync('git status --porcelain', {
      cwd,
      timeout: 2000,
    });
    const isDirty = statusStr.trim().length > 0;

    return {
      isGit: true,
      branch,
      isDirty,
    };
  } catch {
    return { isGit: false };
  }
}

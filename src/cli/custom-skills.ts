import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfigDir } from './paths';

/**
 * A custom skill bundled in this repository.
 * Unlike npx-installed skills, these are copied from src/skills/ to the OpenCode skills directory
 */
export interface CustomSkill {
  /** Skill name (folder name) */
  name: string;
  /** Human-readable description */
  description: string;
  /** List of agents that should auto-allow this skill */
  allowedAgents: string[];
  /** Source path in this repo (relative to project root) */
  sourcePath: string;
}

/**
 * Registry of custom skills bundled in this repository.
 */
export const CUSTOM_SKILLS: CustomSkill[] = [
  {
    name: 'simplify',
    description: 'Code simplification and readability-focused refactoring',
    allowedAgents: ['oracle'],
    sourcePath: 'src/skills/simplify',
  },
  {
    name: 'codemap',
    description: 'Repository understanding and hierarchical codemap generation',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/codemap',
  },
  {
    name: 'clonedeps',
    description: 'Clone important dependency source for local inspection',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/clonedeps',
  },
  {
    name: 'deepwork',
    description:
      'Heavy/complex coding sessions and large modifications workflow',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/deepwork',
  },
  {
    name: 'reflect',
    description:
      'Review repeated work and suggest reusable workflow improvements',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/reflect',
  },
  {
    name: 'oh-my-opencode-slim',
    description:
      'Configure, customize, and safely improve oh-my-opencode-slim setups',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/oh-my-opencode-slim',
  },
  {
    name: 'release-smoke-test',
    description:
      'Validate packed release candidates and bugfixes before public publish',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/release-smoke-test',
  },
  {
    name: 'worktrees',
    description:
      'Manage Git worktrees as OMO safe isolated coding lanes for complex/risky/parallel work',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/worktrees',
  },
];

/**
 * Get the target directory for custom skills installation.
 */
export function getCustomSkillsDir(): string {
  return join(getConfigDir(), 'skills');
}

/**
 * Install a custom skill by copying from src/skills/ to the OpenCode skills directory
 * @param skill - The custom skill to install
 * @returns True if installation succeeded, false otherwise
 * @deprecated Use syncBundledSkillsFromPackage instead.
 */
export async function installCustomSkill(skill: CustomSkill): Promise<boolean> {
  console.warn(
    `[DEPRECATED] installCustomSkill is deprecated and will be removed. Use syncBundledSkillsFromPackage instead.`,
  );
  try {
    const { syncBundledSkillsFromPackage } = await import(
      '../hooks/auto-update-checker/skill-sync'
    );
    const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
    const result = syncBundledSkillsFromPackage(packageRoot, {
      skills: [skill],
    });
    return (
      result.installed.includes(skill.name) ||
      result.skippedExisting.includes(skill.name)
    );
  } catch (error) {
    console.error(
      `Failed to install custom skill safely: ${skill.name}`,
      error,
    );
    return false;
  }
}

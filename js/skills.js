/**
 * ArcEditor Agent Skills Module
 * Scans directories for .md skill files, parses their title and description,
 * handles enable/disable toggling, and compiles them into the LLM system prompt.
 */

window.skillsManager = {
    builtInSkillsDir: "",
    userSkillsDir: "",

    initSkills: async function() {
        if (!fs || !path) {
            console.warn("[ArcEditor Skills] Node.js fs/path not available. Running in mockup browser mode.");
            return;
        }

        try {
            this.builtInSkillsDir = path.join(extensionPath, 'skills');
            this.userSkillsDir = path.join(appConfigDir, 'skills');

            if (!fs.existsSync(this.builtInSkillsDir)) {
                fs.mkdirSync(this.builtInSkillsDir, { recursive: true });
            }
            if (!fs.existsSync(this.userSkillsDir)) {
                fs.mkdirSync(this.userSkillsDir, { recursive: true });
            }

            // Copy default templates to user folder if they don't exist
            const builtInFiles = fs.readdirSync(this.builtInSkillsDir);
            builtInFiles.forEach(file => {
                if (file.toLowerCase().endsWith(".md")) {
                    const src = path.join(this.builtInSkillsDir, file);
                    const dest = path.join(this.userSkillsDir, file);
                    if (!fs.existsSync(dest)) {
                        try {
                            fs.writeFileSync(dest, fs.readFileSync(src));
                        } catch (copyErr) {
                            console.error(`Failed to copy default skill template ${file}:`, copyErr);
                        }
                    }
                }
            });
        } catch (err) {
            console.error("Failed to initialize skills folders:", err);
        }

        await this.reloadSkills();
    },

    reloadSkills: async function() {
        if (!fs) return;

        const builtInList = await this.scanSkillsInDir(this.builtInSkillsDir, true);
        const userList = await this.scanSkillsInDir(this.userSkillsDir, false);
        
        // De-duplicate: if user created a custom skill with the same id as built-in, custom takes precedence
        const uniqueSkillsMap = {};
        builtInList.forEach(s => { uniqueSkillsMap[s.id] = s; });
        userList.forEach(s => { uniqueSkillsMap[s.id] = s; });

        skillsList = Object.values(uniqueSkillsMap);

        // Default any new skills to enabled
        skillsList.forEach(skill => {
            if (enabledSkills[skill.id] === undefined) {
                enabledSkills[skill.id] = true;
            }
        });
    },

    scanSkillsInDir: async function(dir, isBuiltIn) {
        if (!fs || !dir || !fs.existsSync(dir)) return [];
        try {
            const files = await fs.promises.readdir(dir);
            const skills = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (file.toLowerCase().endsWith('.md')) {
                    const filePath = path.join(dir, file);
                    const skill = await this.parseSkillFile(filePath, file, isBuiltIn);
                    if (skill) {
                        skills.push(skill);
                    }
                }
            }
            return skills;
        } catch (err) {
            console.error("Error scanning skills directory:", dir, err);
            return [];
        }
    },

    parseSkillFile: async function(filePath, fileName, isBuiltIn) {
        try {
            const content = await fs.promises.readFile(filePath, 'utf8');
            const lines = content.split(/\r?\n/);
            let title = fileName.replace(/\.md$/i, '').replace(/_/g, ' '); // Fallback
            let description = "Custom skill template."; // Fallback
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith('#')) {
                    // Extract Title from markdown header
                    title = line.replace(/^#+\s*/, '').trim();
                } else if (line.toLowerCase().startsWith('description:')) {
                    // Extract Description
                    description = line.substring(12).trim();
                }
            }
            
            const skillId = fileName.replace(/\.md$/i, '').toLowerCase();
            return {
                id: skillId,
                fileName: fileName,
                filePath: filePath,
                title: title,
                description: description,
                isBuiltIn: isBuiltIn
            };
        } catch (err) {
            console.error("Failed to parse skill file:", filePath, err);
            return null;
        }
    },

    toggleSkill: function(skillId, enabled) {
        enabledSkills[skillId] = !!enabled;
        if (typeof saveSettings === "function") {
            saveSettings();
        }
    },

    openSkillsFolder: function() {
        if (!fs || !os) return;
        try {
            const child_process = require('child_process');
            const platform = os.platform();
            if (platform === "win32") {
                child_process.exec(`explorer.exe "${this.userSkillsDir}"`);
            } else if (platform === "darwin") {
                child_process.exec(`open "${this.userSkillsDir}"`);
            } else {
                console.warn("Folder opening not supported on this platform.");
            }
        } catch (err) {
            console.error("Failed to open skills directory in explorer:", err);
        }
    },

    getEnabledSkillsInstructions: async function() {
        if (!fs) return "";
        let compiled = "";
        
        for (let i = 0; i < skillsList.length; i++) {
            const skill = skillsList[i];
            if (enabledSkills[skill.id]) {
                try {
                    const content = await fs.promises.readFile(skill.filePath, 'utf8');
                    compiled += `\n---\n### SKILL: ${skill.title}\n${content}\n`;
                } catch (err) {
                    console.error(`Failed to read skill content for ${skill.id}:`, err);
                }
            }
        }
        
        if (compiled) {
            compiled = `\n\n=== ACTIVE CUSTOM SKILLS & WORKFLOWS ===\nYou have access to the following custom skills and workflows. Always follow these design patterns and code structures when appropriate:\n${compiled}\n========================================\n`;
        }
        return compiled;
    }
};

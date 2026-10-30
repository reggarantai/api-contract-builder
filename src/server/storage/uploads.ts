import fs from "node:fs";
import path from "node:path";

/** Uploaded files on disk: `<uploadsDir>/<projectId>/<fileName>`, served at `/uploads/...`. */
export function createUploadStorage(uploadsDir: string) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const projectDir = (projectId: string) => path.join(uploadsDir, projectId);

  return {
    dir: uploadsDir,
    write(projectId: string, fileName: string, data: Uint8Array) {
      fs.mkdirSync(projectDir(projectId), { recursive: true });
      fs.writeFileSync(path.join(projectDir(projectId), fileName), data);
    },
    read(projectId: string, fileName: string): Uint8Array | undefined {
      const file = path.join(projectDir(projectId), fileName);
      return fs.existsSync(file) ? fs.readFileSync(file) : undefined;
    },
    remove(projectId: string, fileName: string) {
      fs.rmSync(path.join(projectDir(projectId), fileName), { force: true });
    },
    removeProject(projectId: string) {
      fs.rmSync(projectDir(projectId), { recursive: true, force: true });
    },
    url(projectId: string, fileName: string) {
      return `/uploads/${projectId}/${fileName}`;
    },
  };
}

export type UploadStorage = ReturnType<typeof createUploadStorage>;

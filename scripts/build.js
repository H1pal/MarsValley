import { cp, mkdir, rm } from 'node:fs/promises';

const output = new URL('../dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ['index.html', 'favicon.svg', 'src']) {
  await cp(new URL(`../${name}`, import.meta.url), new URL(name, output), { recursive: true });
}
console.log('정적 배포 파일 생성 완료: dist/');

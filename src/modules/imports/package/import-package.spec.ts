import ExcelJS from 'exceljs';
import { readImportPackage, ImportPackageLimits } from './import-package';
import { normalizeEntryName } from './zip-archive';
import { ImportPackageError } from './import-package-error';
import { buildRawZip, buildWorkbook, buildZip, PNG_BYTES } from '../../../../test/utils/import-package';

const LIMITS: ImportPackageLimits = {
  maxEntries: 30,
  maxEntryBytes: 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
  maxRowsPerSheet: 100,
};

const reasonOf = (promise: Promise<unknown>): Promise<string> =>
  promise.then(
    () => 'resolved',
    (error: unknown) => (error instanceof ImportPackageError ? error.reason : String(error)),
  );

describe('readImportPackage', () => {
  const workbook = () =>
    buildWorkbook({
      questions: [
        { questionKey: 'q1', type: 'SINGLE', stem: '题干\r\n第二行', answer: 'A', difficulty: 2 },
        { questionKey: '', type: '', stem: '' },
      ],
      notes: [{ any: 'ignored' }],
    });

  it('should read content.xlsx and assets from a zip', async () => {
    const pkg = await readImportPackage(
      await buildZip({ 'content.xlsx': await workbook(), 'assets/chart.png': PNG_BYTES }),
      LIMITS,
    );

    expect(pkg.sheets.questions).toEqual([
      {
        sheet: 'questions',
        row: 2,
        values: { questionKey: 'q1', type: 'SINGLE', stem: '题干\n第二行', answer: 'A', difficulty: '2' },
      },
    ]);
    expect(pkg.sheets.papers).toEqual([]);
    expect([...pkg.assets.keys()]).toEqual(['chart.png']);
  });

  it('should strip a single top-level folder and read content.json', async () => {
    const json = JSON.stringify({ questions: [{ type: 'SHORT_ANSWER', points: ['要点一', '要点二'], difficulty: 3 }] });
    const pkg = await readImportPackage(
      await buildZip({ 'pkg/content.json': json, 'pkg/assets/sub/a.png': PNG_BYTES, '__MACOSX/pkg/._a': 'x' }),
      LIMITS,
    );

    expect(pkg.sheets.questions[0]).toEqual({
      sheet: 'questions',
      row: 1,
      values: { type: 'SHORT_ANSWER', points: '要点一\n要点二', difficulty: '3' },
    });
    expect([...pkg.assets.keys()]).toEqual(['sub/a.png']);
  });

  it('should read a standalone workbook or JSON file without assets', async () => {
    await expect(readImportPackage(await workbook(), LIMITS)).resolves.toMatchObject({ assets: new Map() });
    const json = await readImportPackage(Buffer.from('\uFEFF{"papers":[{"paperKey":"p1"}]}'), LIMITS);
    expect(json.sheets.papers).toHaveLength(1);
  });

  it('should reject packages without content or in unknown formats', async () => {
    await expect(reasonOf(readImportPackage(await buildZip({ 'other.txt': 'x' }), LIMITS))).resolves.toBe(
      'importContentMissing',
    );
    await expect(reasonOf(readImportPackage(Buffer.from('MZ\x90\x00'), LIMITS))).resolves.toBe('importInvalidPackage');
    await expect(reasonOf(readImportPackage(Buffer.from('{"questions": 1}'), LIMITS))).resolves.toBe(
      'importInvalidJson',
    );
    await expect(reasonOf(readImportPackage(Buffer.from('{oops'), LIMITS))).resolves.toBe('importInvalidJson');
  });

  it('should reject too many entries', async () => {
    const entries = Object.fromEntries(
      Array.from({ length: LIMITS.maxEntries + 1 }, (_, index) => [`assets/${index}.png`, PNG_BYTES]),
    );

    await expect(reasonOf(readImportPackage(await buildZip(entries), LIMITS))).resolves.toBe('importTooManyEntries');
  });

  it('should stop extracting a highly compressed entry beyond the size limit', async () => {
    const bomb = await buildZip({ 'content.json': Buffer.alloc(LIMITS.maxEntryBytes + 1, 0x20) });

    expect(bomb.length).toBeLessThan(64 * 1024);
    await expect(reasonOf(readImportPackage(bomb, LIMITS))).resolves.toBe('importPackageTooLarge');
  });

  it('should limit the total extracted size', async () => {
    const half = Buffer.alloc(LIMITS.maxEntryBytes - 1, 0x20);
    const zip = await buildZip({ 'assets/a.bin': half, 'assets/b.bin': half, 'assets/c.bin': half });

    await expect(reasonOf(readImportPackage(zip, LIMITS))).resolves.toBe('importPackageTooLarge');
  });

  it('should reject sheets with too many rows', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({ exam: 'E', subject: 'S', path: `K${index}` }));

    await expect(
      reasonOf(readImportPackage(Buffer.from(JSON.stringify({ knowledge_points: rows })), LIMITS)),
    ).resolves.toBe('importTooManyRows');
    await expect(reasonOf(readImportPackage(await buildWorkbook({ knowledge_points: rows }), LIMITS))).resolves.toBe(
      'importTooManyRows',
    );
  });

  it('should normalize entry names and refuse unsafe paths', () => {
    expect(normalizeEntryName('assets\\a.png')).toBe('assets/a.png');
    expect(normalizeEntryName('./assets//a.png')).toBe('assets/a.png');
    expect(normalizeEntryName('../evil.sh')).toBeNull();
    expect(normalizeEntryName('assets/../../evil.sh')).toBeNull();
    expect(normalizeEntryName('/etc/passwd')).toBeNull();
    expect(normalizeEntryName('C:/evil.exe')).toBeNull();
  });

  it('should decode GBK and UTF-8 entry names and still refuse unsafe ones', async () => {
    const gbkName = Buffer.concat([Buffer.from('assets/'), Buffer.from('cdbcb1ed', 'hex'), Buffer.from('.png')]);
    const zip = buildRawZip([
      { name: Buffer.from('content.json'), content: Buffer.from('{"questions":[]}'), utf8: false },
      { name: gbkName, content: PNG_BYTES, utf8: false },
      { name: Buffer.from('assets/资料.png'), content: PNG_BYTES, utf8: false },
      { name: Buffer.from('assets/音频.png'), content: PNG_BYTES, utf8: true },
    ]);

    const pkg = await readImportPackage(zip, LIMITS);

    expect([...pkg.assets.keys()]).toEqual(['图表.png', '资料.png', '音频.png']);
    const unsafe = buildRawZip([{ name: Buffer.from('../evil.sh'), content: Buffer.from('x'), utf8: false }]);
    await expect(reasonOf(readImportPackage(unsafe, LIMITS))).resolves.toBe('importInvalidPackage');
  });

  it('should apply the archive limits to the embedded workbook', async () => {
    const zip = await buildZip({
      'content.xlsx': await buildZip({ 'xl/huge.xml': Buffer.alloc(LIMITS.maxEntryBytes + 1, 0x20) }),
    });

    await expect(reasonOf(readImportPackage(zip, LIMITS))).resolves.toBe('importPackageTooLarge');
  });

  it('should mark date cells and keep fixed decimals of number cells', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('questions');
    sheet.addRow(['stem', 'answer', 'score']);
    const row = sheet.addRow([new Date('2024-01-02T00:00:00Z'), 0.5, 3]);
    row.getCell(2).numFmt = '0.00';

    const pkg = await readImportPackage(Buffer.from(await workbook.xlsx.writeBuffer()), LIMITS);

    expect(pkg.sheets.questions[0]).toMatchObject({
      values: { answer: '0.50', score: '3' },
      dateColumns: ['stem'],
    });
  });
});

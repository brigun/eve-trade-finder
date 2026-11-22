import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMetaInfo,
  extractSkillRequirements,
  formatDogmaValue,
  parseEveDescription,
  supportsEveRender,
  toRomanNumeral,
} from '../gameInfoFormat.ts';

describe('parseEveDescription', () => {
  it('parses EVE markup, line breaks, entities, and showinfo links safely', () => {
    const raw =
      '<b>Primary</b> &amp; <i>secondary</i> traits.<br><br>' +
      '<font color="#ff9900">See</font> <a href=showinfo:2456>Hobgoblin II</a> ' +
      'and <a href="showinfo:1378//500001">Caldari Navy</a>.<script>alert(1)</script>' +
      '<br/>Quotes: &quot;Jita&quot; &#39;4-4&#39;';

    const paragraphs = parseEveDescription(raw);
    assert.equal(paragraphs.length, 3);

    assert.deepEqual(paragraphs[0], [
      { text: 'Primary', bold: true },
      { text: ' & ' },
      { text: 'secondary', italic: true },
      { text: ' traits.' },
    ]);

    assert.deepEqual(paragraphs[1], [
      { text: 'See ' },
      { text: 'Hobgoblin II', showInfoTypeId: 2456 },
      { text: ' and ' },
      { text: 'Caldari Navy', loreLink: true },
      { text: '.' },
    ]);

    assert.deepEqual(paragraphs[2], [{ text: 'Quotes: "Jita" \'4-4\'' }]);
  });

  it('returns empty array for blank descriptions', () => {
    assert.deepEqual(parseEveDescription('   <br>  '), []);
    assert.deepEqual(parseEveDescription(''), []);
  });
});

describe('formatDogmaValue', () => {
  it('formats standard EVE unit_ids accurately', () => {
    assert.equal(formatDogmaValue(500, 101), '500 ms');
    assert.equal(formatDogmaValue(4500, 101), '4.5 s');
    assert.equal(formatDogmaValue(25, 105), '25%');
    assert.equal(formatDogmaValue(30, 106), '30 tf');
    assert.equal(formatDogmaValue(12.5, 107), '12.5 MW');
    assert.equal(formatDogmaValue(0.675, 108), '32.5%');
    assert.equal(formatDogmaValue(1.15, 109), '+15%');
    assert.equal(formatDogmaValue(0.85, 109), '-15%');
    assert.equal(
      formatDogmaValue(16242, 116, (id) => (id === 16242 ? 'Scourge Rage Heavy Missile' : null)),
      'Scourge Rage Heavy Missile',
    );
    assert.equal(formatDogmaValue(999, 116), 'Type #999');
    assert.equal(formatDogmaValue(2, 117), 'Medium');
    assert.equal(formatDogmaValue(1, 137), 'Yes');
    assert.equal(formatDogmaValue(0, 137), 'No');
  });
});

describe('extractSkillRequirements & extractMetaInfo', () => {
  it('extracts skill requirements with Roman numerals and meta info', () => {
    const attrs = [
      { attribute_id: 182, value: 3300 },
      { attribute_id: 277, value: 4 },
      { attribute_id: 183, value: 3301 },
      { attribute_id: 278, value: 1 },
      { attribute_id: 633, value: 5 },
      { attribute_id: 422, value: 2 },
      { attribute_id: 1692, value: 2 },
    ];

    const skills = extractSkillRequirements(attrs, (id) =>
      id === 3300 ? 'Gunnery' : id === 3301 ? 'Small Hybrid Turret' : null,
    );
    assert.deepEqual(skills, [
      { skillTypeId: 3300, skillName: 'Gunnery', level: 4, levelRoman: 'IV' },
      { skillTypeId: 3301, skillName: 'Small Hybrid Turret', level: 1, levelRoman: 'I' },
    ]);

    assert.deepEqual(extractMetaInfo(attrs), {
      metaLevel: 5,
      techLevel: 2,
      metaGroupLabel: 'Tech II',
    });

    assert.equal(toRomanNumeral(5), 'V');
    assert.equal(supportsEveRender('Ship'), true);
    assert.equal(supportsEveRender('Charge'), false);
  });
});

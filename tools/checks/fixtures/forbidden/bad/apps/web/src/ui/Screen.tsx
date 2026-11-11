export function BadScreen() {
  const label = '직접 쓴 한국어';
  return (
    <div>
      <span>✨ 반가워요</span>
      <select aria-label={label}>
        <option value="a">A</option>
      </select>
    </div>
  );
}

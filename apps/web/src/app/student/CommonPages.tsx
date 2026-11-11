import { useNavigate } from 'react-router';
import { ClosedView } from '../../ui/screens/common/Closed.tsx';
import { PrivacyView } from '../../ui/screens/common/Privacy.tsx';
import { privacyBlocks } from './privacyContent.tsx';

/** `/privacy` 처리방침(PRD 13.2). 본문은 `docs/privacy-policy.md` 원본을 그대로 보여 준다(`privacyContent.tsx`). */
export function PrivacyPage() {
  const navigate = useNavigate();
  return (
    <PrivacyView
      onBack={() => {
        // 앱 안에서 왔으면 그 화면으로, 바로 열었으면 홈으로.
        if (globalThis.history.length > 1) navigate(-1);
        else navigate('/');
      }}
    >
      {privacyBlocks()}
    </PrivacyView>
  );
}

/** 없는 주소(PRD 7.2): 닫힌 문 그림 + `처음으로`. */
export function MissingPage() {
  const navigate = useNavigate();
  return <ClosedView kind="missingPage" onHome={() => navigate('/')} />;
}

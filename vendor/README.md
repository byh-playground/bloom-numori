# 넘모리에서 사용하는 BLOOM GameKit

단일 HTML에 포함할 GameKit 런타임을 이 폴더에 보관한다. `python pack.py`는 체크인된 파일을 읽으므로 배포 파일을 조립하거나 싱글플레이를 실행할 때 GameKit 체크아웃이나 외부 CDN이 필요하지 않다.

## 공용 기능과 게임 규칙

| 공개 API | 사용처 | 소유하는 동작 |
| --- | --- | --- |
| `createLoop` | 게임 화면 | 30Hz 고정 시뮬레이션, RAF와 렌더링 보간 시간 |
| `UniformGrid` | 전장 시뮬레이션 | 적 탐색·충돌 후보의 결정적 공간 질의 |
| `statelessRandom` | 전장 시뮬레이션 | 전투 시드와 개체 ID로부터 재현 가능한 값 산출 |
| `SeededPRNG` | 채집 경제 | 숫자·연산 기호의 광산별 난수 스트림 |
| `CameraViewport`, `OrthographicProjection` | 전장 표시 | 카메라와 월드·화면 좌표의 변환 |
| `WebGLDevice`, `VectorContext`, `TextureAtlasArray` | 전장 렌더러 | WebGL 2 프레임, 버퍼·아틀라스, 인스턴스 드로우 및 장치 복구 |
| `createNostrRoom` | 1대1 방 | 4자리 채널의 피어 발견과 WebRTC 앱 채널 |

수식 검증, 자원 차감, 소환, 병종 상성은 넘모리 도메인에 둔다. 공용 기능의 선택 기준은 [BLOOM Reference AI-021](https://github.com/byh-playground/bloom-reference/blob/main/rules/ai-development.md#module-first)에 따른다.

## 코어 번들 재현

기준 소스는 [bloom-gamekit `9dd41e95`](https://github.com/byh-playground/bloom-gamekit/tree/9dd41e95f8064dc6c96f057d66f35ca9e9d690b4)이다. `gamekit-core.js`에는 위 표의 루프·공간·난수·카메라·렌더링 API를 `NumoriGameKit` 전역으로 노출한다. 생성 스크립트가 체크아웃의 Git 객체에서 정확한 커밋을 읽고 그 커밋의 package-lock에 고정된 esbuild 0.28.2로 묶는다. 난수 API는 대응하는 구현 파일에서 가져와 사용하지 않는 코덱 초기화를 제외한다.

해당 커밋을 보유한 GameKit 체크아웃에 `npm ci`로 도구를 설치한 뒤 넘모리 폴더에서 실행한다. 아래의 체크아웃 위치는 자신의 경로로 바꾼다.

```sh
node tools/vendor-gamekit-core.mjs ../bloom-gamekit --check
```

갱신할 때는 스크립트의 `sourceCommit`과 이 문서의 기준 소스를 바꾸고 `--check` 없이 다시 생성한다. 현재 코어 번들의 SHA-256은 `21d34e7263332f98a7888d5d01d396649bb0b53b750c944d1fe4f2add9ffbc8c`이다.

기존 오프라인 사본의 기준 커밋은 `e5287fac368cc88e4ca8284210855f46ce5ca5c3`이다. 새 핀과 대조해 소비한 루프·공간·카메라·난수 구현이 동일함을 확인했다. 이관 검수에서는 시드 1·42·123·8192를 각각 1,800틱 진행하고 전투 통계, 개별 병력의 ID·좌표·체력, 양측 인벤토리·일꾼·목표의 해시를 이전 사본과 비교했다.

## 전송 번들

동일 소스 커밋의 [배포 아티팩트](https://github.com/byh-playground/bloom-gamekit/blob/10b27d8ea7f816586e41973d37d4bd2a01cc8755/transport.js)를 별도 번들로 포함한다. 설치 및 생성 정보는 전송 어댑터와 함께 제공된다.



## 전장 GPU 배치

넘모리는 GameKit의 `VectorContext.beginFrame/endFrame`으로 프레임을 열고 닫는다. 지형 타일, 건물, 병력의 리그 파츠, 투사체와 효과는 공유 아틀라스의 영역을 참조한다. `gpu-batch.js`는 제출 순서를 보존한 채 파츠당 60바이트(변환, UV, 아틀라스 번호, 색상)를 저장하고, `WebGLDevice.draw`로 사각형 인스턴스를 일괄 제출한다. 아틀라스는 2048×1024 RGBA 텍스처 1장(8 MiB)에서 시작해 필요한 만큼 늘린다. 서로 다른 아틀라스를 같은 드로우에서 샘플링한다.

`?debug=1&gpuBatch=vector`는 같은 좌표와 그림으로 GameKit의 공개 `VectorContext.drawQuads` 배치를 비교하는 경로이다. `?debug=1&gpuBatch=single`은 쿼드마다 제출해 배치 전 드로우콜을 측정한다. 출시 기본값은 인스턴스 배치다. 쌀콩팡은 GPU 포즈 채널로 리그를 평가하는 경로도 사용한다. 넘모리의 근거리 관절은 게임 동작 시간에 맞춰 계산한 파츠 행렬을 GPU에 전송하고, 원거리 및 밀집 병력은 공용 자세 이미지를 참조한다. `drawCalls`와 `instancedDrawCalls`는 실제 GameKit 장치 카운터이며, `quads`는 그 프레임에 제출한 인스턴스 수이다.

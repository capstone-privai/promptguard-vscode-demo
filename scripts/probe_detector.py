from credsweeper import CredSweeper
from credsweeper.file_handler.string_content_provider import StringContentProvider


CASES = [
    "API_KEY=sk-example-123456",
    "API_KEY=Z9q7Lm2Vx8Np4Rt6Yw3Kd5Hs1Ua9Ce7Gi2Mo8Qz4",
    "Authorization: Bearer abcdef123456",
    "Authorization: Bearer Z9q7Lm2Vx8Np4Rt6Yw3Kd5Hs1Ua9Ce7Gi2Mo8Qz4",
    "postgresql://admin:secret123@prod-db.internal:5432/payments",
    "mysql://user:secret@db.internal:3306/app",
    "https://admin:secret@example.internal/api",
    "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
    "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "docker run -e DB_PASSWORD=secret123 app",
    '{"password": "secret123"}',
]


def main() -> None:
    scanner = CredSweeper(ml_threshold=0, use_filters=True, pool_count=1).scanner
    for value in CASES:
        candidates = scanner.scan(StringContentProvider([value], file_path="fixture.txt"))
        print("CASE", value)
        for candidate in candidates:
            print(
                candidate.rule_name,
                [
                    (
                        item.value,
                        item.value_start,
                        item.value_end,
                        item.url_part,
                        item.variable,
                        item.key,
                    )
                    for item in candidate.line_data_list
                ],
            )


if __name__ == "__main__":
    main()

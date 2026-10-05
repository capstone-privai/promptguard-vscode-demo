import unittest

from detector_adapter import scan


class DetectorAdapterTest(unittest.TestCase):
    def test_synthetic_cases(self) -> None:
        api_key = "Z9q7Lm2Vx8Np4Rt6Yw3Kd5Hs1Ua9Ce7Gi2Mo8Qz4"
        repeated = "synthetic-db-password"
        text = "\n".join(
            [
                f"API_KEY={api_key}",
                f"DB_PASSWORD={repeated}",
                "postgresql://admin:secret123@prod-db.internal:5432/payments",
                "export LOG_LEVEL=debug",
                f'{{"password": "{repeated}"}}',
            ]
        )
        detections = scan(text, "synthetic.txt")
        values = [text[item["start"]:item["end"]] for item in detections]
        self.assertIn(api_key, values)
        self.assertEqual(values.count(repeated), 2)
        self.assertIn("secret123", values)
        self.assertNotIn("prod-db.internal", values)
        self.assertNotIn("5432", values)
        self.assertFalse(any("LOG_LEVEL" in value for value in values))


if __name__ == "__main__":
    unittest.main()

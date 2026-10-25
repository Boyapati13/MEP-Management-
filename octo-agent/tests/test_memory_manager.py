import unittest
from unittest.mock import patch
from datetime import datetime
import copy

from memory.memory_manager import update_memory, MAX_VALUE_LENGTH

class TestUpdateMemory(unittest.TestCase):
    def setUp(self):
        # Initial state mock for memory
        self.initial_memory = {
            "identity": {"name": {"value": "Alice", "updated": "2023-01-01"}},
            "preferences": {"color": {"value": "blue", "updated": "2023-01-01"}},
            "projects": {},
            "relationships": {},
            "wishes": {},
            "notes": {}
        }

        # Mocks setup
        self.patcher_load = patch('memory.memory_manager.load_memory')
        self.mock_load_memory = self.patcher_load.start()
        self.mock_load_memory.side_effect = lambda: copy.deepcopy(self.initial_memory)

        self.patcher_save = patch('memory.memory_manager.save_memory')
        self.mock_save_memory = self.patcher_save.start()

        # Patch datetime to freeze time, though we need to patch datetime in memory_manager
        # since it's imported as `from datetime import datetime`.
        # However, patching `memory.memory_manager.datetime` works when imported that way.
        self.patcher_datetime = patch('memory.memory_manager.datetime')
        self.mock_datetime = self.patcher_datetime.start()

        # Configure mock_datetime.now() to return a specific mock object with a fixed strftime
        self.mock_datetime.now.return_value.strftime.return_value = "2024-05-15"

    def tearDown(self):
        self.patcher_load.stop()
        self.patcher_save.stop()
        self.patcher_datetime.stop()

    def test_invalid_updates(self):
        # Testing None
        result = update_memory(None)
        self.assertEqual(result, self.initial_memory)
        self.mock_save_memory.assert_not_called()

        # Testing empty dict
        result = update_memory({})
        self.assertEqual(result, self.initial_memory)
        self.mock_save_memory.assert_not_called()

        # Testing list
        result = update_memory(["invalid"])
        self.assertEqual(result, self.initial_memory)
        self.mock_save_memory.assert_not_called()

    def test_valid_update_new_key(self):
        update = {"preferences": {"food": "pizza"}}
        result = update_memory(update)

        expected_memory = copy.deepcopy(self.initial_memory)
        expected_memory["preferences"]["food"] = {"value": "pizza", "updated": "2024-05-15"}

        self.assertEqual(result, expected_memory)
        self.mock_save_memory.assert_called_once_with(expected_memory)

    def test_valid_update_existing_key(self):
        update = {"identity": {"name": "Bob"}}
        result = update_memory(update)

        expected_memory = copy.deepcopy(self.initial_memory)
        expected_memory["identity"]["name"] = {"value": "Bob", "updated": "2024-05-15"}

        self.assertEqual(result, expected_memory)
        self.mock_save_memory.assert_called_once_with(expected_memory)

    def test_valid_update_no_change(self):
        # Update with the exact same value shouldn't trigger save
        update = {"identity": {"name": "Alice"}}
        result = update_memory(update)

        self.assertEqual(result, self.initial_memory)
        self.mock_save_memory.assert_not_called()

    def test_skip_empty_values(self):
        update = {
            "preferences": {"food": None, "music": "   ", "movie": ""}
        }
        result = update_memory(update)

        # None and empty strings should be skipped, so no changes
        self.assertEqual(result, self.initial_memory)
        self.mock_save_memory.assert_not_called()

    def test_truncation(self):
        long_string = "A" * (MAX_VALUE_LENGTH + 50)
        expected_string = "A" * MAX_VALUE_LENGTH + "…"

        update = {"notes": {"long_note": long_string}}
        result = update_memory(update)

        expected_memory = copy.deepcopy(self.initial_memory)
        expected_memory["notes"]["long_note"] = {"value": expected_string, "updated": "2024-05-15"}

        self.assertEqual(result, expected_memory)
        self.mock_save_memory.assert_called_once_with(expected_memory)

    def test_nested_dictionary_value(self):
        # Testing if passing {"value": "something"} directly works
        update = {"projects": {"alpha": {"value": "running"}}}
        result = update_memory(update)

        expected_memory = copy.deepcopy(self.initial_memory)
        expected_memory["projects"]["alpha"] = {"value": "running", "updated": "2024-05-15"}

        self.assertEqual(result, expected_memory)
        self.mock_save_memory.assert_called_once_with(expected_memory)

if __name__ == '__main__':
    unittest.main()

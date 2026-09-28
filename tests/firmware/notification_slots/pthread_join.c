/*
 * SPDX-FileCopyrightText: 2018-2024 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

int pthread_join(pthread_t thread, void **retval)
{
    esp_pthread_t *pthread = (esp_pthread_t *)thread;
    int ret = 0;
    bool wait = false;
    void *child_task_retval = 0;

    ESP_LOGV(TAG, "%s %p", __FUNCTION__, pthread);

    // find task
    _lock_acquire(&s_threads_lock);

    TaskHandle_t handle = pthread_find_handle(thread);
    if (!handle) {
        // not found
        ret = ESRCH;
    } else if (pthread->detached) {
        // Thread is detached
        ret = EDEADLK;
    } else if (pthread->join_task) {
        // already have waiting task to join
        ret = EINVAL;
    } else if (handle == xTaskGetCurrentTaskHandle()) {
        // join to self not allowed
        ret = EDEADLK;
    } else {
        esp_pthread_t *cur_pthread = pthread_find(xTaskGetCurrentTaskHandle());
        if (cur_pthread && cur_pthread->join_task == handle) {
            // join to each other not allowed
            ret = EDEADLK;
        } else {
            if (pthread->state == PTHREAD_TASK_STATE_RUN) {
                pthread->join_task = xTaskGetCurrentTaskHandle();
                wait = true;
            } else { // thread has exited and task is already suspended, or about to be suspended
                child_task_retval = pthread->retval;
                pthread_delete(pthread);
            }
        }
    }
    _lock_release(&s_threads_lock);

    if (ret == 0) {
        if (wait) {
            xTaskNotifyWait(0, 0, NULL, portMAX_DELAY);
            _lock_acquire(&s_threads_lock);
            child_task_retval = pthread->retval;
            pthread_delete(pthread);
            _lock_release(&s_threads_lock);
        }
        /* clean up thread local storage before task deletion */
        pthread_internal_local_storage_destructor_callback(handle);
        vTaskDelete(handle);
    }

    if (retval) {
        *retval = child_task_retval;
    }

    ESP_LOGV(TAG, "%s %p EXIT %d", __FUNCTION__, pthread, ret);
    return ret;
}
